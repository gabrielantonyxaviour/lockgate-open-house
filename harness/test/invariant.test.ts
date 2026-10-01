import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toBytes, type Address } from "viem";
import { loadCtx, read, send } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { proposalTuple, type AdvanceProposal } from "../src/eip712.js";
import { readManifest } from "../src/manifest.js";
import { balanceOf, expect, expectRevert } from "../src/actions/common.js";
import { depositCapital, exitNow, markLate, postReserve, registerPlatform } from "../src/actions/stage1.js";
import { approvePlatform, depositVault, setMandate } from "../src/actions/stage2.js";
import { books, depositJunior, depositSenior, drawFacility } from "../src/actions/stage3.js";
import { ROLES } from "../src/roles.js";
import { parseUsdg } from "../src/units.js";
import { withAnvil } from "./anvil.js";

test("book, vault cash, and facility stay solvent across draws and a late mark", { timeout: 180_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    const governor = await read<Address>(ctx, "CreditFacility", "governor");
    const borrower = await read<Address>(ctx, "CreditFacility", "borrower");
    assert.equal(governor.toLowerCase(), ROLES.governor.address.toLowerCase());
    assert.equal(borrower.toLowerCase(), ROLES.lockgate.address.toLowerCase());
    assert.notEqual(governor.toLowerCase(), borrower.toLowerCase());

    await registerPlatform(ctx, { kind: "1", limitUsdg: "25000", reserveBps: "750", initialShares: "1000" });
    await depositCapital(ctx, { amountUsdg: "100000" });
    await postReserve(ctx, { amountUsdg: "100" });
    await assertBook(ctx, 0n);
    await exitNow(ctx, { shares: "1000" });
    const open = await assertBook(ctx);
    expect(open.eligible > 0n && open.late === 0n, "a fresh advance was already late", open);
    await expectRevert(() => markLate(ctx, { advanceId: "1", warp: "false" }), "TooEarly");
    await assertBook(ctx);

    await depositSenior(ctx, { amountUsdg: "1000" });
    await depositJunior(ctx, { amountUsdg: "400" });
    await assertFacility(ctx, 0n);
    await expectRevert(() => send(ctx, "lockgate", "CreditFacility", "approveLender", [ROLES.senior.address, true]), "Unauthorized");
    await expectRevert(() => send(ctx, "governor", "CreditFacility", "draw", [parseUsdg("10")]), "Unauthorized");
    await drawFacility(ctx, { amountUsdg: "100" });
    await assertFacility(ctx, parseUsdg("100"));

    await markLate(ctx, { advanceId: "1" });
    const late = await assertBook(ctx);
    expect(late.late > 0n, "slash of 100 USDG cleared a 1000-share advance", late);
    await assertFacility(ctx, parseUsdg("100"));
  });
});

test("mandate boundaries reject fee, tenor, deadline, and concentration", { timeout: 180_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    await registerPlatform(ctx, { kind: "1", limitUsdg: "25000", reserveBps: "750" });
    await setMandate(ctx, { vault: "PartnerVaultA", minFeeBps: "25", concentrationBps: "1" });
    await approvePlatform(ctx, { vault: "PartnerVaultA" });
    const now = (await ctx.publicClient.getBlock()).timestamp;
    const week = 7n * 86_400n;
    const low = 499_999n;
    const floor = 500_000n;

    expect(await reason(ctx, offer(ctx, now + 3_600n, now, low, 1n)) === 7, "a deadline equal to now was rejected early");
    expect(await reason(ctx, offer(ctx, now + 3_600n, now - 1n, floor, 2n)) === 16, "a past deadline was accepted");
    expect(await reason(ctx, offer(ctx, now + week, now + 86_400n, low, 3n)) === 7, "a tenor equal to the max was rejected");
    expect(await reason(ctx, offer(ctx, now + week + 1n, now + 86_400n, floor, 4n)) === 8, "a tenor one second over was accepted");

    await depositVault(ctx, { vault: "PartnerVaultA", amountUsdg: "20000" });
    await assertVault(ctx);
    const idle = await read<bigint>(ctx, "PartnerVaultA", "idle");
    expect(await reason(ctx, offer(ctx, now + 3_600n, now + 86_400n, floor, 5n)) === 6, "concentration let the nav through");
    expect((await read<bigint>(ctx, "PartnerVaultA", "idle")) === idle, "a rejected preview moved idle");
    await assertVault(ctx);
  });
});

async function assertBook(
  ctx: Awaited<ReturnType<typeof loadCtx>>,
  expected?: bigint,
): Promise<{ eligible: bigint; late: bigint }> {
  const eligible = await read<bigint>(ctx, "LockgateCreditLine", "eligibleOutstanding");
  const late = await read<bigint>(ctx, "LockgateCreditLine", "lateOutstanding");
  const exposure = await read<bigint>(ctx, "LockgateCreditLine", "totalExposure");
  expect(eligible + late === exposure, "eligible plus late left total exposure", {
    eligible: eligible.toString(), late: late.toString(), exposure: exposure.toString(),
  });
  if (expected !== undefined) {
    expect(exposure === expected, "book exposure drifted", {
      exposure: exposure.toString(), expected: expected.toString(),
    });
  }
  return { eligible, late };
}

async function assertFacility(ctx: Awaited<ReturnType<typeof loadCtx>>, drawn: bigint): Promise<void> {
  const state = await books(ctx);
  expect(state.drawn === drawn, "facility drawn drifted", { drawn: state.drawn.toString(), expected: drawn.toString() });
  expect(await read<boolean>(ctx, "CreditFacility", "solvent"), "facility solvency broke");
  const cash = await read<{ cash: bigint }>(ctx, "CreditFacility", "accounting");
  const tokens = await balanceOf(ctx, ctx.binding("CreditFacility").address);
  expect(tokens === BigInt(cash.cash), "facility tokens left accounting cash", {
    tokens: tokens.toString(), cash: cash.cash.toString(),
  });
}

async function assertVault(ctx: Awaited<ReturnType<typeof loadCtx>>): Promise<void> {
  const vault = ctx.binding("PartnerVaultA").address;
  const cash = await balanceOf(ctx, vault);
  const idle = await read<bigint>(ctx, "PartnerVaultA", "idle");
  const reserve = await read<bigint>(ctx, "PartnerVaultA", "reserveCash");
  expect(cash === idle + reserve, "vault tokens left idle plus reserve", {
    cash: cash.toString(), idle: idle.toString(), reserve: reserve.toString(),
  });
}

function offer(ctx: Awaited<ReturnType<typeof loadCtx>>, dueAt: bigint, expiresAt: bigint, fee: bigint, nonce: bigint): AdvanceProposal {
  const navValue = parseUsdg("200");
  return {
    platform: ctx.binding("WeeklyQueuePlatform").address,
    recipient: ROLES.platform.address,
    requestId: nonce,
    navValue,
    fee,
    payout: navValue - fee,
    feeBps: 25,
    dueAt,
    expiresAt,
    nonce,
    quoteId: keccak256(toBytes(`lockgate.invariant.${nonce}`)),
  };
}

async function reason(ctx: Awaited<ReturnType<typeof loadCtx>>, proposal: AdvanceProposal): Promise<number> {
  return Number(await read(ctx, "PartnerVaultA", "preview", [proposalTuple(proposal)]));
}
