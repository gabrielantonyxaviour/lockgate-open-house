import type { Address } from "viem";
import { deployer, fail, investor, publicClient, read, send, usd, deploy } from "./chain.js";
import { engineQuote } from "./engine.js";

const NAV = usd(10_000n);

export async function runStage1(now: number) {
  const token = await deploy("MockUSDG", [deployer.address]);
  const adapter = await deploy("UsdgAdapter", [token, true]);
  const pricing = await deploy("PricingEngine", [deployer.address]);
  const reserve = await deploy("PlatformReserve", [deployer.address, adapter]);
  const line = await deploy("LockgateCreditLine", [deployer.address, adapter, pricing, reserve]);
  await send("PlatformReserve", reserve, "setCreditLine", [line], deployer);
  await send("PlatformReserve", reserve, "setSlasher", [line, true], deployer);
  const actor = await deploy("CreditActor", [line, token, investor.address]);

  await send("LockgateCreditLine", line, "registerSource", [actor, usd(1_000_000n), 750], deployer);
  await send("MockUSDG", token, "mint", [deployer.address, usd(200_000n)], deployer);
  await send("MockUSDG", token, "approve", [line, usd(200_000n)], deployer);
  await send("LockgateCreditLine", line, "depositCapital", [usd(200_000n)], deployer);
  await send("MockUSDG", token, "mint", [actor, usd(20_000n)], deployer);
  await send("CreditActor", actor, "postReserve", [usd(20_000n)], deployer);

  const pinned = await priced(pricing, 600n);
  if (pinned.bps !== 99 || !pinned.available) fail("quote", `600s curve was ${pinned.bps} (${pinned.reason})`);
  const engine = await engineQuote(now, NAV);
  if (!engine.available || engine.feeBps < 25 || engine.feeBps > 1500) {
    fail("engine", `stage-1 engine quote unavailable: ${engine.blocks.map((item) => item.code).join(",")}`);
  }

  const investorBefore = await read<bigint>("MockUSDG", token, "balanceOf", [investor.address]);
  const actorBefore = await read<bigint>("MockUSDG", token, "balanceOf", [actor]);
  await send("CreditActor", actor, "refresh", [600n], deployer);
  const windowAt = await read<bigint>("CreditActor", actor, "nextWindow");
  const seen = await publicClient.getBlock();
  const secondsLeft = windowAt - seen.timestamp;
  const live = await priced(pricing, secondsLeft);
  const chain = await read<[bigint, number, boolean, string]>("LockgateCreditLine", line, "quote", [actor, NAV]);
  if (!chain[2] || chain[1] !== live.bps) {
    fail("quote", `stage-1 chain quote was ${chain[1]} at ${secondsLeft}s (${chain[3]})`);
  }

  await send("CreditActor", actor, "draw", [NAV], deployer);
  const advance = await read<unknown>("LockgateCreditLine", line, "getAdvance", [1n]);
  const fee = BigInt(cell(advance, "fee", 3));
  const principal = BigInt(cell(advance, "principal", 2));
  const drawSeconds = BigInt(cell(advance, "dueAt", 5)) - BigInt(cell(advance, "drawnAt", 4));
  const charged = await priced(pricing, drawSeconds);
  const expectedFee = (NAV * BigInt(charged.bps) + 9_999n) / 10_000n;
  if (!charged.available || principal + fee !== NAV || fee !== expectedFee) {
    fail("quote", `draw fee ${fee} was not ${charged.bps} bps on a ${drawSeconds}s wait`);
  }
  const investorAfterDraw = await read<bigint>("MockUSDG", token, "balanceOf", [investor.address]);
  const actorAfterDraw = await read<bigint>("MockUSDG", token, "balanceOf", [actor]);
  if (investorAfterDraw !== investorBefore + principal) fail("repay-first", "investor did not receive nav minus fee");
  if (actorAfterDraw !== actorBefore) fail("repay-first", "draw pulled USDG from the platform");

  await send("MockUSDG", token, "mint", [actor, NAV], deployer);
  await send("CreditActor", actor, "repay", [1n], deployer);
  const investorAfterRepay = await read<bigint>("MockUSDG", token, "balanceOf", [investor.address]);
  const outstanding = await read<bigint>("LockgateCreditLine", line, "outstanding");
  const earned = await read<bigint>("LockgateCreditLine", line, "earnedFees");
  if (investorAfterRepay !== investorAfterDraw) fail("repay-first", "repay took tokens from the investor");
  if (outstanding !== 0n || earned !== fee) fail("solvency", "repay did not clear principal and realize the fee");

  return {
    chainFeeBps: chain[1],
    engineFeeBps: engine.feeBps,
    fee: fee.toString(),
    investorPaid: principal.toString(),
    outstanding: outstanding.toString(),
    earnedFees: earned.toString(),
    line,
  };
}

async function priced(pricing: Address, seconds: bigint): Promise<{ bps: number; available: boolean; reason: string }> {
  const row = await read<unknown>("PricingEngine", pricing, "feeBps", [seconds, 0n, false, 0, 0]);
  return {
    bps: Number(cell(row, "bps", 0)),
    available: Boolean(cell(row, "available", 1)),
    reason: String(cell(row, "reason", 2) ?? ""),
  };
}

function cell<T>(value: unknown, name: string, index: number): T {
  if (Array.isArray(value)) return value[index] as T;
  return (value as Record<string, T>)[name];
}
