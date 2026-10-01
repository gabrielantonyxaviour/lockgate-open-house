import { read, type Ctx } from "../chain.js";
import { feeFromBps, modelFeeBps } from "../model.js";
import { ROLES } from "../roles.js";
import { formatUsdg, parseUsdg } from "../units.js";
import { balanceOf, expect, expectRevert, same } from "./common.js";
import {
  buyShares, depositCapital, depositCash, exitNow, markLate, pauseLine, postReserve, processWindow, quote,
  registerPlatform, requestRedeem, requestView, setGated,
} from "./stage1.js";
import {
  approvePlatform, approveProposal, assertLockgateHasNoControl, depositVault, enlist, payInvestor, postVaultReserve,
  preview, proposeUpgrade, repayRoute, routedAdvance, setMandate, setPaused,
} from "./stage2.js";
import { approveLenders, books, borrowingBase, depositJunior, depositSenior, drawFacility, recognizeLoss, waterfall } from "./stage3.js";

export async function demoStage1(ctx: Ctx): Promise<unknown> {
  await registerPlatform(ctx, { kind: "1", limitUsdg: "25000", reserveBps: "750", initialShares: "1100" });
  await depositCapital(ctx, { amountUsdg: "100000" });
  await postReserve(ctx, { amountUsdg: "2000" });
  const block = await ctx.publicClient.getBlock();
  const next = await read<bigint>(ctx, "WeeklyQueuePlatform", "nextWindow");
  const priced = await quote(ctx, { navUsdg: "1000" });
  const bps = modelFeeBps(next - block.timestamp);
  expect(priced.available, "quote unavailable", priced.reason);
  expect(priced.feeBps === bps, "fee bps diverged from the stage-1 curve", { priced, bps });
  expect(priced.fee === feeFromBps(parseUsdg("1000"), bps), "fee rounding diverged", priced);

  await setGated(ctx, { gated: "true" });
  const gated = await quote(ctx, { navUsdg: "1000" });
  expect(!gated.available && gated.reason === "gated", "gate did not block the quote", gated);
  await setGated(ctx, { gated: "false" });
  await pauseLine(ctx, { paused: "true" });
  const paused = await quote(ctx, { navUsdg: "1000" });
  expect(!paused.available && paused.reason === "paused", "pause did not block the quote", paused);
  await pauseLine(ctx, { paused: "false" });

  const queued = await requestRedeem(ctx, { shares: "100" }) as { requestId: string };
  const drawn = await exitNow(ctx, { shares: "1000" }) as { advanceId: string; nav: string; received: string };
  const advance = await read<{ principal: bigint; fee: bigint }>(ctx, "LockgateCreditLine", "getAdvance", [BigInt(drawn.advanceId)]);
  expect(BigInt(advance.principal) + BigInt(advance.fee) === BigInt(drawn.nav), "advance does not add up to nav", advance);
  expect(BigInt(drawn.received) === BigInt(advance.principal), "investor did not receive the principal", drawn);
  const advanceRemaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [BigInt(drawn.advanceId)]);
  await depositCash(ctx, { amountUsdg: formatUsdg(advanceRemaining - 1n) });
  const held = await processWindow(ctx, {});
  const stillDue = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [BigInt(drawn.advanceId)]);
  const queuedView = await requestView(ctx, "WeeklyQueuePlatform", BigInt(queued.requestId));
  expect(stillDue === advanceRemaining, "a short cash deposit repaid the advance", { stillDue, advanceRemaining });
  expect(queuedView.status === 0, "queue was paid before the advance", queuedView);
  expect((held as { nextWindow: string }).nextWindow === next.toString(), "window rolled on a failed repay");

  await depositCash(ctx, { amountUsdg: formatUsdg(1n) });
  await processWindow(ctx, {});
  const repaid = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [BigInt(drawn.advanceId)]);
  const afterRepay = await requestView(ctx, "WeeklyQueuePlatform", BigInt(queued.requestId));
  expect(repaid === 0n, "advance was not repaid", repaid.toString());
  expect(afterRepay.status === 0, "queue was paid with the repayment cash", afterRepay);

  const queueNav = await requestView(ctx, "WeeklyQueuePlatform", BigInt(queued.requestId));
  await depositCash(ctx, { amountUsdg: formatUsdg(queueNav.navValue) });
  await processWindow(ctx, {});
  const paid = await requestView(ctx, "WeeklyQueuePlatform", BigInt(queued.requestId));
  expect(paid.status === 2, "queued exit was not paid", paid);

  await buyShares(ctx, { shares: "5000" });
  const lateDraw = await exitNow(ctx, { shares: "5000" }) as { advanceId: string; nav: string };
  const late = await markLate(ctx, { advanceId: lateDraw.advanceId }) as { status: number; remaining: string };
  const reserve = await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [ctx.binding("WeeklyQueuePlatform").address]);
  expect(late.status === 2, "advance was not marked late", late);
  expect(BigInt(late.remaining) === BigInt(lateDraw.nav) - parseUsdg("2000"), "slash did not consume the posted reserve", late);
  expect(reserve === 0n, "reserve was not fully slashed", reserve.toString());
  return { lateAdvance: lateDraw.advanceId, shortfall: late.remaining };
}

export async function demoStage2(ctx: Ctx): Promise<unknown> {
  const blocked = await assertLockgateHasNoControl(ctx);
  await setMandate(ctx, { vault: "PartnerVaultA", minFeeBps: "25" });
  await setMandate(ctx, { vault: "PartnerVaultB", minFeeBps: "50" });
  await approvePlatform(ctx, { vault: "PartnerVaultA" });
  await approvePlatform(ctx, { vault: "PartnerVaultB" });
  await postVaultReserve(ctx, { vault: "PartnerVaultA", amountUsdg: "200" });
  await postVaultReserve(ctx, { vault: "PartnerVaultB", amountUsdg: "200" });
  await depositVault(ctx, { vault: "PartnerVaultA", amountUsdg: "20000" });
  await depositVault(ctx, { vault: "PartnerVaultB", amountUsdg: "40000" });
  await enlist(ctx, { vault: "PartnerVaultA" });
  await enlist(ctx, { vault: "PartnerVaultB" });

  const idleBefore = await read<bigint>(ctx, "PartnerVaultA", "idle");
  const funded = await routedAdvance(ctx, { navUsdg: "1000", strategy: "0", nonce: "1", rejectLockgate: "true" }) as {
    vault: string; fee: string; navValue: string; exitRef: string;
  };
  expect(funded.vault === "PartnerVaultA", "best fee did not pick the lower mandate", funded.vault);
  const idleFunded = await read<bigint>(ctx, "PartnerVaultA", "idle");
  expect(idleBefore - idleFunded === BigInt(funded.navValue) - BigInt(funded.fee), "vault cash out was not nav minus fee");
  await payInvestor(ctx, { amountUsdg: formatUsdg(BigInt(funded.navValue) - BigInt(funded.fee)) });
  await sendMint(ctx, ROLES.platform.address, BigInt(funded.navValue));
  await repayRoute(ctx, { exitRef: funded.exitRef });
  const idleAfter = await read<bigint>(ctx, "PartnerVaultA", "idle");
  expect(idleAfter - idleBefore === BigInt(funded.fee), "repayment did not leave the fee in the vault", {
    idleBefore: idleBefore.toString(), idleAfter: idleAfter.toString(), fee: funded.fee,
  });

  await setPaused(ctx, "PartnerVaultA", true);
  await setPaused(ctx, "PartnerVaultB", true);
  const none = await preview(ctx, { navUsdg: "1000", strategy: "0", nonce: "9" });
  expect(none.slices.length === 0, "paused vaults were still eligible", none);
  await setPaused(ctx, "PartnerVaultA", false);
  await setPaused(ctx, "PartnerVaultB", false);

  const first = await routedAdvance(ctx, { navUsdg: "500", strategy: "2", nonce: "2" }) as { vault: string };
  const second = await routedAdvance(ctx, { navUsdg: "500", strategy: "2", nonce: "3" }) as { vault: string };
  expect(first.vault !== second.vault, "round robin used the same vault twice", { first, second });
  const approved = await approveProposal(ctx, { navUsdg: "400", strategy: "0", nonce: "4", rejectLockgate: "true" }) as { vault: string };
  expect(approved.vault === "PartnerVaultA", "approve did not use the lower fee vault", approved.vault);
  const upgrade = await proposeUpgrade(ctx, { vault: "PartnerVaultA" }) as { eta: string };
  const now = await ctx.publicClient.getBlock();
  expect(BigInt(upgrade.eta) > now.timestamp, "upgrade eta is not in the future", upgrade);
  return { blocked, funded: funded.vault, roundRobin: [first.vault, second.vault] };
}

export async function demoStage3(ctx: Ctx): Promise<unknown> {
  await registerPlatform(ctx, { kind: "2", limitUsdg: "25000", reserveBps: "750" });
  await postReserve(ctx, { platform: "EpochQueuePlatform", amountUsdg: "2000" });
  await buyShares(ctx, { platform: "EpochQueuePlatform", shares: "5000" });
  const drawn = await exitNow(ctx, { platform: "EpochQueuePlatform", shares: "5000" }) as { advanceId: string };
  const base = await borrowingBase(ctx);
  expect(base > parseUsdg("2000"), "borrowing base did not see the active advance", base.toString());
  await approveLenders(ctx);
  await depositSenior(ctx, { amountUsdg: "10000" });
  await depositJunior(ctx, { amountUsdg: "4000" });
  await drawFacility(ctx, { amountUsdg: "2000" });
  await expectRevert(() => drawFacility(ctx, { amountUsdg: "5000" }), "Covenant");

  await markLate(ctx, { advanceId: drawn.advanceId });
  const seniorBefore = await balanceOf(ctx, ROLES.senior.address);
  const paid = await waterfall(ctx, { amountUsdg: "10" }) as { seniorInterestAfter: string; seniorGain: string };
  const seniorAfter = await balanceOf(ctx, ROLES.senior.address);
  expect(seniorAfter > seniorBefore, "senior did not receive interest", { seniorBefore, seniorAfter });
  expect(paid.seniorInterestAfter === "0", "senior interest remained due", paid);
  expect(BigInt(paid.seniorGain) > 0n, "withdrawInterest paid nothing", paid);

  const beforeLoss = await books(ctx);
  await recognizeLoss(ctx);
  const afterLoss = await books(ctx);
  expect(afterLoss.recovery, "facility did not enter recovery");
  expect(afterLoss.juniorPrincipal < beforeLoss.juniorPrincipal, "junior principal was not written down", afterLoss);
  expect(afterLoss.seniorPrincipal === beforeLoss.seniorPrincipal, "senior principal changed in a junior-first loss", {
    before: beforeLoss.seniorPrincipal.toString(), after: afterLoss.seniorPrincipal.toString(),
  });
  return { base: base.toString(), juniorAfter: afterLoss.juniorPrincipal.toString() };
}

export async function demoAll(ctx: Ctx): Promise<unknown> {
  const stage1 = await demoStage1(ctx);
  const stage2 = await demoStage2(ctx);
  const stage3 = await demoStage3(ctx);
  expect(!same(ROLES.lockgate.address, ROLES.partnerA.address), "roles collided");
  return { stage1, stage2, stage3 };
}

async function sendMint(ctx: Ctx, to: `0x${string}`, amount: bigint): Promise<void> {
  const { send } = await import("../chain.js");
  await send(ctx, "lockgate", "MockUSDG", "mint", [to, amount]);
}
