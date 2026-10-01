import { encodeFunctionData, zeroAddress, type Abi, type Address } from "viem";
import { artifact, deploy, send, type Anvil } from "./chain.js";

export const U = 1_000_000n;

export type World = {
  node: Anvil;
  usdg: Address;
  pricing: Address;
  line: Address;
  factory: Address;
  vault: Address;
  facility: Address;
  book: Address;
  usdgAbi: Abi;
  lineAbi: Abi;
  pricingAbi: Abi;
  factoryAbi: Abi;
  vaultAbi: Abi;
  facilityAbi: Abi;
  bookAbi: Abi;
};

export async function deployWorld(node: Anvil): Promise<World> {
  const lockgate = node.account(0).address;
  const usdg = await deploy(node, 0, "MockUSDG", [lockgate]);
  const adapter = await deploy(node, 0, "UsdgAdapter", [usdg, true]);
  const pricing = await deploy(node, 0, "PricingEngine", [lockgate]);
  const reserve = await deploy(node, 0, "PlatformReserve", [lockgate, adapter]);
  const line = await deploy(node, 0, "LockgateCreditLine", [lockgate, adapter, pricing, reserve]);
  const reserveAbi = artifact("PlatformReserve").abi;
  await send(node, 0, reserve, reserveAbi, "setCreditLine", [line]);
  await send(node, 0, reserve, reserveAbi, "setSlasher", [line, true]);
  const blank = {
    token: zeroAddress,
    creditLine: zeroAddress,
    reserve: zeroAddress,
    issuer: zeroAddress,
    name: "",
    nav: 0n,
    interval: 0n,
    initialHolder: zeroAddress,
    initialShares: 0n,
  };
  const weekly = await deploy(node, 0, "WeeklyCyclePlatform", [blank]);
  const epoch = await deploy(node, 0, "EpochQueuePlatform", [blank]);
  const quarter = await deploy(node, 0, "QuarterlyWindowPlatform", [blank]);
  const factory = await deploy(node, 0, "FundFactory", [lockgate, adapter, line, reserve, weekly, epoch, quarter]);
  const lineAbi = artifact("LockgateCreditLine").abi;
  await send(node, 0, line, lineAbi, "setRegistrar", [factory, true]);

  const vaultAbi = artifact("PartnerVault").abi;
  const impl = await deploy(node, 0, "PartnerVault", []);
  const init = encodeFunctionData({
    abi: vaultAbi,
    functionName: "initialize",
    args: [node.account(2).address, usdg, 2n * 86_400n, 86_400n],
  });
  const vault = await deploy(node, 0, "ERC1967Proxy", [impl, init]);

  const book = await deploy(node, 0, "MockBook", []);
  const facility = await deploy(node, 0, "CreditFacility", [{
    governor: node.account(1).address,
    borrower: lockgate,
    asset: usdg,
    book,
    oracle: zeroAddress,
    minPriceE8: 0n,
    maxOracleAge: 0n,
    advanceRateBps: 8_000,
    maxLateBps: 10_000,
    minJuniorBps: 0,
    seniorAprBps: 1_200n,
    juniorAprBps: 1_800n,
  }]);

  const usdgAbi = artifact("MockUSDG").abi;
  await send(node, 0, usdg, usdgAbi, "mint", [lockgate, 80_000n * U]);
  await send(node, 0, usdg, usdgAbi, "mint", [node.account(1).address, 30_000n * U]);
  await send(node, 0, usdg, usdgAbi, "mint", [node.account(2).address, 30_000n * U]);
  await send(node, 0, usdg, usdgAbi, "mint", [node.account(3).address, 500_000n * U]);
  await send(node, 0, usdg, usdgAbi, "mint", [node.account(4).address, 500_000n * U]);

  return {
    node,
    usdg,
    pricing,
    line,
    factory,
    vault,
    facility,
    book,
    usdgAbi,
    lineAbi,
    pricingAbi: artifact("PricingEngine").abi,
    factoryAbi: artifact("FundFactory").abi,
    vaultAbi,
    facilityAbi: artifact("CreditFacility").abi,
    bookAbi: artifact("MockBook").abi,
  };
}

export async function approve(world: World, from: number, spender: Address, amount: bigint): Promise<void> {
  await send(world.node, from, world.usdg, world.usdgAbi, "approve", [spender, amount]);
}
