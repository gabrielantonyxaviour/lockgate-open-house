import { deployer, fail, investor, read, send, usd, deploy } from "./chain.js";
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
  await send("CreditActor", actor, "refresh", [600n], deployer);

  const engine = await engineQuote(now, NAV);
  const chain = await read<[bigint, number, boolean, string]>("LockgateCreditLine", line, "quote", [actor, NAV]);
  if (!chain[2] || chain[1] !== 99) fail("quote", `stage-1 chain quote was ${chain[1]} (${chain[3]})`);
  if (!engine.available || engine.feeBps < 25 || engine.feeBps > 1500) {
    fail("engine", `stage-1 engine quote unavailable: ${engine.blocks.map((item) => item.code).join(",")}`);
  }

  const investorBefore = await read<bigint>("MockUSDG", token, "balanceOf", [investor.address]);
  const actorBefore = await read<bigint>("MockUSDG", token, "balanceOf", [actor]);
  await send("CreditActor", actor, "draw", [NAV], deployer);
  const fee = chain[0];
  const investorAfterDraw = await read<bigint>("MockUSDG", token, "balanceOf", [investor.address]);
  const actorAfterDraw = await read<bigint>("MockUSDG", token, "balanceOf", [actor]);
  if (investorAfterDraw !== investorBefore + (NAV - fee)) fail("repay-first", "investor did not receive nav minus fee");
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
    investorPaid: (NAV - fee).toString(),
    outstanding: outstanding.toString(),
    earnedFees: earned.toString(),
    line,
  };
}
