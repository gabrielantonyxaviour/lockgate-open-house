import {
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  getCreate2Address,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { loadArtifact, protocolRoot } from "./artifacts.js";
import { loadCtx, send } from "./chain.js";
import { HarnessError } from "./errors.js";
import { ANVIL_CHAIN_ID, assertHarnessWrite, assertLocalRpc } from "./guards.js";
import { manifestPath, writeManifest, type Manifest } from "./manifest.js";
import { DEMO } from "./params.js";
import { ROLES, type RoleName } from "./roles.js";
import { usdg } from "./units.js";

const DAY = 86_400n;

export type Planned = { logical: string; from: RoleName; salt: Hex; init: Hex; address: Address };

export type ProtocolOwners = { owner: Address; governor: Address; partnerA: Address; partnerB: Address };

const SEED: Record<RoleName, bigint> = {
  lockgate: usdg(200_000n),
  platform: usdg(40_000n),
  partnerA: usdg(80_000n),
  partnerB: usdg(50_000n),
  senior: usdg(100_000n),
  junior: usdg(20_000n),
  investor: usdg(20_000n),
};

function saltFor(logical: string): Hex {
  return keccak256(toBytes(`lockgate.protocol.${logical}.v1`));
}

function initOf(logical: string, args: readonly unknown[]): Hex {
  const artifact = loadArtifact(logical);
  return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
}

export async function deployProtocol(rpc: string, manifestFile?: string): Promise<Manifest> {
  assertLocalRpc(rpc);
  const factory = getContractAddress({ from: ROLES.lockgate.address, nonce: 0n });
  const planned = protocolPlan(factory);
  const contracts: Record<string, Address> = { Create2Factory: factory };
  for (const item of planned) contracts[item.logical] = item.address;
  const manifest: Manifest = {
    mode: "protocol",
    chainId: ANVIL_CHAIN_ID,
    rpc,
    artifactRoot: protocolRoot,
    factory,
    contracts,
    roles: Object.fromEntries(Object.entries(ROLES).map(([name, role]) => [name, role.address])),
  };
  const file = manifestFile ?? manifestPath(ANVIL_CHAIN_ID);
  writeManifest(manifest, file);
  const ctx = await loadCtx(manifest, file);
  assertHarnessWrite(ctx.chainId);
  const nonce = await ctx.publicClient.getTransactionCount({ address: ROLES.lockgate.address });
  if (nonce !== 0) throw new HarnessError("Lockgate nonce must be 0 on a fresh Anvil", "NOT_FRESH");

  const artifact = loadArtifact("Create2Factory");
  const wallet = ctx.wallet("lockgate");
  if (!wallet.account) throw new HarnessError("Lockgate account missing", "ROLE_UNKNOWN");
  const factoryHash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    account: wallet.account,
    chain: wallet.chain,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash: factoryHash });

  for (const item of planned) {
    try {
      await send(ctx, item.from, "Create2Factory", "deploy", [item.salt, item.init]);
    } catch (err) {
      const message = err instanceof HarnessError ? err.message : "deploy failed";
      throw new HarnessError(`${item.logical} create2 failed: ${message}`, "DEPLOY_FAILED", err instanceof HarnessError ? err.details : undefined);
    }
    const code = await ctx.publicClient.getBytecode({ address: item.address });
    if (!code || code === "0x") throw new HarnessError(`${item.logical} missing at ${item.address}`, "DEPLOY_MISMATCH");
  }
  await wire(ctx);
  for (const [role, amount] of Object.entries(SEED) as Array<[RoleName, bigint]>) {
    await send(ctx, "lockgate", "MockUSDG", "mint", [ROLES[role].address, amount]);
  }
  return manifest;
}

async function wire(ctx: Awaited<ReturnType<typeof loadCtx>>): Promise<void> {
  const line = ctx.binding("LockgateCreditLine").address;
  const factory = ctx.binding("FundFactory").address;
  const vault = ctx.binding("OpenCreditVault").address;
  await send(ctx, "lockgate", "PlatformReserve", "setCreditLine", [line]);
  await send(ctx, "lockgate", "PlatformReserve", "setSlasher", [line, true]);
  await send(ctx, "lockgate", "LockgateCreditLine", "setRegistrar", [factory, true]);
  await send(ctx, "lockgate", "MockUSDG", "setMinter", [factory, true]);
  await send(ctx, "lockgate", "MockUSDG", "setMinter", [vault, true]);
}

export function protocolPlan(factory: Address, owners: ProtocolOwners = anvilOwners(), externalAsset?: Address): Planned[] {
  const usdg = externalAsset
    ? { logical: "MockUSDG", from: "lockgate" as RoleName, salt: saltFor("MockUSDG"), init: "0x" as Hex, address: externalAsset }
    : predict(factory, "MockUSDG", [owners.owner]);
  const adapter = predict(factory, "UsdgAdapter", [usdg.address, !externalAsset]);
  const pricing = predict(factory, "PricingEngine", [owners.owner]);
  const reserve = predict(factory, "PlatformReserve", [owners.owner, adapter.address]);
  const line = predict(factory, "LockgateCreditLine", [owners.owner, adapter.address, pricing.address, reserve.address]);
  const router = predict(factory, "Router", []);
  const impl = predict(factory, "PartnerVaultImpl", []);
  const creditBook = predict(factory, "CreditLineBook", [line.address]);
  const facility = predict(factory, "CreditFacility", [facilityInit(owners.governor, owners.owner, usdg.address, creditBook.address)]);
  const vaultA = predictProxy(factory, "PartnerVaultA", impl.address, owners.partnerA, usdg.address);
  const vaultB = predictProxy(factory, "PartnerVaultB", impl.address, owners.partnerB, usdg.address);
  const locked = lockedConfig();
  const weekly = predict(factory, "WeeklyImpl", [locked]);
  const epoch = predict(factory, "EpochImpl", [locked]);
  const quarter = predict(factory, "QuarterImpl", [locked]);
  const fundFactory = predict(factory, "FundFactory", [
    owners.owner, adapter.address, line.address, reserve.address, weekly.address, epoch.address, quarter.address,
  ]);
  const openVault = predict(factory, "OpenCreditVault", [owners.owner, usdg.address, !externalAsset]);
  const exitPool = predict(factory, "LockgateExitPool", [owners.owner, openVault.address, line.address]);
  const planned = [
    usdg, adapter, pricing, reserve, line, router, impl, creditBook, facility, vaultA, vaultB,
    weekly, epoch, quarter, fundFactory, openVault, exitPool,
  ];
  return externalAsset ? planned.filter((item) => item.logical !== "MockUSDG") : planned;
}

function lockedConfig() {
  return {
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
}

function anvilOwners(): ProtocolOwners {
  return {
    owner: ROLES.lockgate.address,
    governor: ROLES.governor.address,
    partnerA: ROLES.partnerA.address,
    partnerB: ROLES.partnerB.address,
  };
}

function facilityInit(governor: Address, borrower: Address, asset: Address, book: Address) {
  return {
    governor,
    borrower,
    asset,
    book,
    oracle: zeroAddress,
    minPriceE8: 0n,
    maxOracleAge: 0n,
    advanceRateBps: DEMO.advanceRateBps,
    maxLateBps: 10_000,
    minJuniorBps: 0,
    seniorAprBps: BigInt(DEMO.seniorAprBps),
    juniorAprBps: BigInt(DEMO.juniorAprBps),
  };
}

function predict(factory: Address, logical: string, args: readonly unknown[], from: RoleName = "lockgate"): Planned {
  const init = initOf(logical, args);
  const salt = saltFor(logical);
  return { logical, from, salt, init, address: getCreate2Address({ from: factory, salt, bytecode: init }) };
}

function predictProxy(factory: Address, logical: string, impl: Address, owner: Address, asset: Address): Planned {
  const vault = loadArtifact("PartnerVaultImpl");
  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "initialize",
    args: [owner, asset, 2n * DAY, BigInt(DEMO.grace)],
  });
  const from: RoleName = logical === "PartnerVaultA" ? "partnerA" : "partnerB";
  const init = initOf("ERC1967Proxy", [impl, data]);
  const salt = saltFor(logical);
  return { logical, from, salt, init, address: getCreate2Address({ from: factory, salt, bytecode: init }) };
}
