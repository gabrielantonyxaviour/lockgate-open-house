import { keccak256, toBytes, type Address, type Hex } from "viem";
import { read, send, type Ctx } from "../chain.js";
import { HarnessError } from "../errors.js";
import { ROLES } from "../roles.js";
import { formatUsdg, parseUsdg } from "../units.js";
import { SHARE, balanceOf, expect, expectRevert, same, shareBalance } from "./common.js";
import {
  approvePlatform, approveProposal, assertLockgateHasNoControl, depositVault, enlist, payInvestor,
  postVaultReserve, preview, proposeUpgrade, repayRoute, routedAdvance, setMandate, setPaused,
} from "./stage2.js";
import {
  approveLenders, books, borrowingBase, depositJunior, depositSenior, drawFacility, recognizeLoss, waterfall,
} from "./stage3.js";
import { buyShares, exitNow, markLate, postReserve, registerPlatform } from "./stage1.js";

const EPOCH = "EpochQueuePlatform";
const FIVE = 5000n * SHARE;
const VAULTS = ["PartnerVaultA", "PartnerVaultB"] as const;

export async function resumeStage2(ctx: Ctx): Promise<unknown> {
  const done = await finishedStage2(ctx);
  if (done) return done;
  const blocked = await nonceOn(ctx, 1n)
    ? { owner: await read<Address>(ctx, "PartnerVaultA", "owner"), lockgateCanMoveFunds: false }
    : await assertLockgateHasNoControl(ctx);
  await setMandate(ctx, { vault: "PartnerVaultA", minFeeBps: "25" });
  await setMandate(ctx, { vault: "PartnerVaultB", minFeeBps: "50" });
  await approvePlatform(ctx, { vault: "PartnerVaultA" });
  await approvePlatform(ctx, { vault: "PartnerVaultB" });
  await fundVault(ctx, "PartnerVaultA", parseUsdg("200"), parseUsdg("20000"));
  await fundVault(ctx, "PartnerVaultB", parseUsdg("200"), parseUsdg("40000"));
  const funded = await bestFee(ctx);
  await setPaused(ctx, "PartnerVaultA", true);
  await setPaused(ctx, "PartnerVaultB", true);
  const none = await preview(ctx, { navUsdg: "1000", strategy: "0", nonce: "9" });
  expect(none.slices.length === 0, "paused vaults were still eligible", none);
  await setPaused(ctx, "PartnerVaultA", false);
  await setPaused(ctx, "PartnerVaultB", false);
  const first = await robin(ctx, "2");
  const second = await robin(ctx, "3");
  expect(first !== second, "round robin used the same vault twice", { first, second });
  if (!(await nonceOn(ctx, 4n))) {
    const approved = await approveProposal(ctx, { navUsdg: "400", strategy: "0", nonce: "4", rejectLockgate: "true" }) as { vault: string };
    expect(approved.vault === "PartnerVaultA", "approve did not use the lower fee vault", approved.vault);
  }
  const eta = await read<bigint>(ctx, "PartnerVaultA", "scheduledEta");
  if (eta === 0n) {
    const upgrade = await proposeUpgrade(ctx, { vault: "PartnerVaultA" }) as { eta: string };
    const now = await ctx.publicClient.getBlock();
    expect(BigInt(upgrade.eta) > now.timestamp, "upgrade eta is not in the future", upgrade);
  }
  return { blocked, funded, roundRobin: [first, second] };
}

export async function resumeStage3(ctx: Ctx): Promise<unknown> {
  const done = await finishedStage3(ctx);
  if (done) return done;
  const created = await registerPlatform(ctx, { kind: "2", limitUsdg: "25000", reserveBps: "750", viaFactory: "true" }) as {
    viaFactory?: boolean; address?: string; existing?: boolean;
  };
  if (!created.existing) {
    expect(created.viaFactory === true, "epoch platform was not created by the factory", created);
    expect(
      created.address?.toLowerCase() !== ctx.binding("EpochImpl").address.toLowerCase(),
      "epoch clone is the locked implementation",
    );
  }
  const source = ctx.binding(EPOCH).address;
  await topReserve(ctx, source);
  const opened = await openEpoch(ctx, source);
  await lenders(ctx);
  const drawn = (await books(ctx)).drawn;
  if (drawn === 0n) await drawFacility(ctx, { amountUsdg: "2000" });
  if (!(await books(ctx)).recovery) await expectRevert(() => drawFacility(ctx, { amountUsdg: "5000" }), "Covenant");
  if (await advanceStatus(ctx, opened.id) !== 2) await markLate(ctx, { advanceId: opened.id.toString() });
  await paySenior(ctx);
  const beforeLoss = await books(ctx);
  if (!beforeLoss.recovery) {
    await recognizeLoss(ctx);
    const afterLoss = await books(ctx);
    expect(afterLoss.recovery, "facility did not enter recovery");
    expect(afterLoss.juniorPrincipal < beforeLoss.juniorPrincipal, "junior principal was not written down", afterLoss);
    expect(afterLoss.seniorPrincipal === beforeLoss.seniorPrincipal, "senior principal changed in a junior-first loss", {
      before: beforeLoss.seniorPrincipal.toString(), after: afterLoss.seniorPrincipal.toString(),
    });
    return { base: opened.base.toString(), juniorAfter: afterLoss.juniorPrincipal.toString() };
  }
  return { base: opened.base.toString(), juniorAfter: beforeLoss.juniorPrincipal.toString() };
}

async function finishedStage2(ctx: Ctx): Promise<unknown | undefined> {
  if (!(await enlisted(ctx, "PartnerVaultA")) || !(await enlisted(ctx, "PartnerVaultB"))) return undefined;
  const funded = await nonceOn(ctx, 1n);
  const first = await nonceOn(ctx, 2n);
  const second = await nonceOn(ctx, 3n);
  if (!funded || !first || !second || !(await nonceOn(ctx, 4n))) return undefined;
  if (await read<bigint>(ctx, "PartnerVaultA", "scheduledEta") === 0n) return undefined;
  const records = await read<Array<{ vault: Address; advanceId: bigint }>>(ctx, "Router", "recordsOf", [bestFeeRef()]);
  const record = records[0];
  if (!record) return undefined;
  const owed = await read<bigint>(ctx, vaultName(ctx, record.vault), "owedOf", [record.advanceId]);
  if (owed !== 0n) return undefined;
  const owner = await read<Address>(ctx, "PartnerVaultA", "owner");
  return { blocked: { owner, lockgateCanMoveFunds: false }, funded, roundRobin: [first, second] };
}

async function fundVault(ctx: Ctx, vault: string, reserve: bigint, cash: bigint): Promise<void> {
  const platform = ctx.binding("WeeklyQueuePlatform").address;
  const posted = await read<bigint>(ctx, vault, "reserveOf", [platform]);
  if (posted < reserve) await postVaultReserve(ctx, { vault, amountUsdg: formatUsdg(reserve - posted) });
  const advances = await read<bigint>(ctx, vault, "advanceCount");
  const idle = await read<bigint>(ctx, vault, "idle");
  if (advances === 0n && idle < cash) await depositVault(ctx, { vault, amountUsdg: formatUsdg(cash - idle) });
  if (!(await enlisted(ctx, vault))) await enlist(ctx, { vault });
}

async function bestFee(ctx: Ctx): Promise<string> {
  const existing = await nonceOn(ctx, 1n);
  if (!existing) {
    const idleBefore = await read<bigint>(ctx, "PartnerVaultA", "idle");
    const funded = await routedAdvance(ctx, { navUsdg: "1000", strategy: "0", nonce: "1", rejectLockgate: "true" }) as {
      vault: string; fee: string; navValue: string; exitRef: string;
    };
    expect(funded.vault === "PartnerVaultA", "best fee did not pick the lower mandate", funded.vault);
    const idleFunded = await read<bigint>(ctx, "PartnerVaultA", "idle");
    expect(idleBefore - idleFunded === BigInt(funded.navValue) - BigInt(funded.fee), "vault cash out was not nav minus fee");
    await payInvestor(ctx, { amountUsdg: formatUsdg(BigInt(funded.navValue) - BigInt(funded.fee)) });
    await send(ctx, "lockgate", "MockUSDG", "mint", [ROLES.platform.address, BigInt(funded.navValue)]);
    await repayRoute(ctx, { exitRef: funded.exitRef });
    const idleAfter = await read<bigint>(ctx, "PartnerVaultA", "idle");
    expect(idleAfter - idleBefore === BigInt(funded.fee), "repayment did not leave the fee in the vault", {
      idleBefore: idleBefore.toString(), idleAfter: idleAfter.toString(), fee: funded.fee,
    });
    return funded.vault;
  }
  const records = await read<Array<{ vault: Address; advanceId: bigint; navValue: bigint }>>(ctx, "Router", "recordsOf", [bestFeeRef()]);
  const record = records[0];
  if (!record) throw new HarnessError("best-fee record is missing", "ASSERTION");
  const vault = vaultName(ctx, record.vault);
  const owed = await read<bigint>(ctx, vault, "owedOf", [record.advanceId]);
  if (owed > 0n) {
    const nav = BigInt(record.navValue);
    await send(ctx, "lockgate", "MockUSDG", "mint", [ROLES.platform.address, nav > 0n ? nav : owed]);
    await repayRoute(ctx, { exitRef: bestFeeRef() });
  }
  return existing;
}

async function robin(ctx: Ctx, nonce: string): Promise<string> {
  const have = await nonceOn(ctx, BigInt(nonce));
  if (have) return have;
  const funded = await routedAdvance(ctx, { navUsdg: "500", strategy: "2", nonce }) as { vault: string };
  return funded.vault;
}

async function finishedStage3(ctx: Ctx): Promise<unknown | undefined> {
  if (!ctx.manifest.contracts[EPOCH]) return undefined;
  const state = await books(ctx);
  if (!state.recovery) return undefined;
  const source = ctx.binding(EPOCH).address;
  const ids = await read<readonly bigint[]>(ctx, "LockgateCreditLine", "advancesOf", [source]);
  for (const id of ids) {
    if (await advanceStatus(ctx, id) !== 2) continue;
    return { base: (await borrowingBase(ctx)).toString(), juniorAfter: state.juniorPrincipal.toString() };
  }
  return undefined;
}

async function topReserve(ctx: Ctx, source: Address): Promise<void> {
  const reserve = await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [source]);
  if (reserve >= parseUsdg("2000")) return;
  const ids = await read<readonly bigint[]>(ctx, "LockgateCreditLine", "advancesOf", [source]);
  for (const id of ids) if (await advanceStatus(ctx, id) === 2) return;
  await postReserve(ctx, { platform: EPOCH, amountUsdg: formatUsdg(parseUsdg("2000") - reserve) });
}

async function openEpoch(ctx: Ctx, source: Address): Promise<{ id: bigint; base: bigint }> {
  const ids = await read<readonly bigint[]>(ctx, "LockgateCreditLine", "advancesOf", [source]);
  if (ids.length === 0) {
    if (await shareBalance(ctx, EPOCH) < FIVE) await buyShares(ctx, { platform: EPOCH, shares: "5000" });
    const drawn = await exitNow(ctx, { platform: EPOCH, shares: "5000" }) as { advanceId: string };
    const base = await borrowingBase(ctx);
    expect(base > parseUsdg("2000"), "borrowing base did not see the active advance", base.toString());
    return { id: BigInt(drawn.advanceId), base };
  }
  const id = ids[ids.length - 1] ?? 0n;
  if (await advanceStatus(ctx, id) === 0) {
    const base = await borrowingBase(ctx);
    expect(base > parseUsdg("2000"), "borrowing base did not see the active advance", base.toString());
    return { id, base };
  }
  return { id, base: await borrowingBase(ctx) };
}

async function lenders(ctx: Ctx): Promise<void> {
  if ((await books(ctx)).recovery) return;
  const senior = await read<boolean>(ctx, "CreditFacility", "approvedLender", [ROLES.senior.address]);
  const junior = await read<boolean>(ctx, "CreditFacility", "approvedLender", [ROLES.junior.address]);
  if (!senior || !junior) await approveLenders(ctx);
  const state = await books(ctx);
  if (state.seniorPrincipal < parseUsdg("10000")) {
    await depositSenior(ctx, { amountUsdg: formatUsdg(parseUsdg("10000") - state.seniorPrincipal) });
  }
  const again = await books(ctx);
  if (again.juniorPrincipal < parseUsdg("4000")) {
    await depositJunior(ctx, { amountUsdg: formatUsdg(parseUsdg("4000") - again.juniorPrincipal) });
  }
}

async function paySenior(ctx: Ctx): Promise<void> {
  if (await pendingSeniorInterest(ctx) === 0n) return;
  const seniorBefore = await balanceOf(ctx, ROLES.senior.address);
  const paid = await waterfall(ctx, { amountUsdg: "10" }) as { seniorInterestAfter: string; seniorGain: string };
  const seniorAfter = await balanceOf(ctx, ROLES.senior.address);
  expect(seniorAfter > seniorBefore, "senior did not receive interest", { seniorBefore, seniorAfter });
  expect(paid.seniorInterestAfter === "0", "senior interest remained due", paid);
  expect(BigInt(paid.seniorGain) > 0n, "withdrawInterest paid nothing", paid);
}

async function enlisted(ctx: Ctx, vault: string): Promise<boolean> {
  const count = await read<bigint>(ctx, "Router", "vaultCount");
  const target = ctx.binding(vault).address;
  for (let i = 0n; i < count; i++) {
    if (same(await read<Address>(ctx, "Router", "vaultList", [i]), target)) return true;
  }
  return false;
}

async function nonceOn(ctx: Ctx, nonce: bigint): Promise<string | undefined> {
  for (const vault of VAULTS) {
    if (await read<boolean>(ctx, vault, "nonceUsed", [nonce])) return vault;
  }
  return undefined;
}

function bestFeeRef(): Hex {
  return keccak256(toBytes(`lockgate.exit.1.0.${parseUsdg("1000")}`));
}

function vaultName(ctx: Ctx, address: Address): string {
  if (same(address, ctx.binding("PartnerVaultA").address)) return "PartnerVaultA";
  if (same(address, ctx.binding("PartnerVaultB").address)) return "PartnerVaultB";
  throw new HarnessError("Vault is not a deployed partner vault", "ASSERTION");
}

/** Stored interest is 0 until a facility call accrues it. Pending interest still has to be paid once. */
async function pendingSeniorInterest(ctx: Ctx): Promise<bigint> {
  const acct = await read<{
    drawn: bigint; seniorPrincipal: bigint; seniorInterestDue: bigint;
    seniorAprBps: bigint; lastAccrual: bigint; recovery: boolean;
  }>(ctx, "CreditFacility", "accounting");
  if (acct.recovery) return 0n;
  let due = BigInt(acct.seniorInterestDue);
  const last = BigInt(acct.lastAccrual);
  const block = await ctx.publicClient.getBlock();
  const drawn = BigInt(acct.drawn);
  if (drawn === 0n || block.timestamp <= last) return due;
  const seniorOut = drawn < BigInt(acct.seniorPrincipal) ? drawn : BigInt(acct.seniorPrincipal);
  const perYear = (seniorOut * BigInt(acct.seniorAprBps)) / 10_000n;
  return due + (perYear * (block.timestamp - last)) / 31_536_000n;
}

async function advanceStatus(ctx: Ctx, id: bigint): Promise<number> {
  const raw = await read(ctx, "LockgateCreditLine", "getAdvance", [id]);
  if (raw && typeof raw === "object" && "status" in raw) return Number((raw as { status: number }).status);
  const parts = Array.isArray(raw) ? raw : [];
  return Number(parts[6]);
}
