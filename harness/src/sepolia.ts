import { createPublicClient, createWalletClient, getContractAddress, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadArtifact, protocolRoot } from "./artifacts.js";
import { protocolPlan, type ProtocolOwners } from "./deploy.js";
import { HarnessError } from "./errors.js";
import { ARBITRUM_ONE, ARBITRUM_SEPOLIA, PAXOS_USDG_SEPOLIA, assertSepoliaBroadcast } from "./guards.js";
import { parseSepoliaEnv, type SepoliaEnv } from "./input.js";
import { preflight } from "./preflight.js";
import { writeManifest, type Manifest } from "./manifest.js";
import { LINE_CAPS } from "./params.js";
import { assertSeedBalance, parseSeedEnv, seedStage1 } from "./sepolia-seed.js";
import { usdg } from "./units.js";

const DEFAULT_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

/**
 * Deploys the protocol when the allow flag, a 32-byte key, and chain 421614 are all present.
 * The flag and the key are checked before any RPC read. Arbitrum One is refused before a
 * transaction. Tests pass a local RPC. This module does not broadcast on import.
 */
export async function broadcastSepolia(env: NodeJS.ProcessEnv, manifestFile: string): Promise<Manifest> {
  const parsed = parseSepoliaEnv(env);
  const seed = parseSeedEnv(env);
  const rpc = parsed.rpc ?? DEFAULT_RPC;
  const chainId = await readChainId(rpc);
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  const key = assertSepoliaBroadcast(chainId, env);
  const account = privateKeyToAccount(key);
  const chain = sepoliaChain(rpc);
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  await preflight({
    target: "sepolia",
    deployer: account.address,
    probe: {
      chainId: async () => chainId,
      balanceOf: (address) => publicClient.getBalance({ address }),
    },
    skipMockUsdg: parsed.paxos,
  });
  // Paxos USDG cannot be minted: refuse before any transaction when the deployer cannot fund the seed.
  if (seed && parsed.paxos) await assertSeedBalance(publicClient, PAXOS_USDG_SEPOLIA as Address, account.address, seed);
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  const factory = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
  const owners = ownersFrom(parsed, account.address);
  const external = parsed.paxos ? PAXOS_USDG_SEPOLIA as Address : undefined;
  const planned = protocolPlan(factory, owners, external);

  const artifact = loadArtifact("Create2Factory");
  const factoryHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, account, chain });
  await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  for (const item of planned) {
    const hash = await wallet.writeContract({
      address: factory, abi: artifact.abi, functionName: "deploy", args: [item.salt, item.init], account, chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const code = await publicClient.getBytecode({ address: item.address });
    if (!code || code === "0x") throw new HarnessError(`${item.logical} missing at ${item.address}`, "DEPLOY_MISMATCH");
  }

  const contracts: Record<string, Address> = { Create2Factory: factory };
  for (const item of planned) contracts[item.logical] = item.address;
  if (external) contracts.MockUSDG = external;
  const line = contracts.LockgateCreditLine;
  const reserve = contracts.PlatformReserve;
  if (!line || !reserve) throw new HarnessError("Credit line or reserve missing from the plan", "DEPLOY_FAILED");
  const send = async (address: Address, name: string, functionName: string, args: readonly unknown[]) => {
    const hash = await wallet.writeContract({ address, abi: loadArtifact(name).abi, functionName, args, account, chain });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new HarnessError(`${name}.${functionName} reverted`, "DEPLOY_FAILED");
    return hash;
  };
  await send(reserve, "PlatformReserve", "setCreditLine", [line]);
  await send(reserve, "PlatformReserve", "setSlasher", [line, true]);
  const fundFactory = contracts.FundFactory;
  if (!fundFactory) throw new HarnessError("Factory missing from the plan", "DEPLOY_FAILED");
  await send(line, "LockgateCreditLine", "setRegistrar", [fundFactory, true]);
  await send(line, "LockgateCreditLine", "setCaps", [LINE_CAPS.utilizationBps, LINE_CAPS.concentrationBps]);
  if (!external) {
    const tokenAddress = contracts.MockUSDG as Address;
    await send(tokenAddress, "MockUSDG", "setMinter", [fundFactory, true]);
    await send(tokenAddress, "MockUSDG", "mint", [account.address, usdg(1_000_000n)]);
  }
  if (seed) {
    await assertSeedBalance(publicClient, contracts.MockUSDG as Address, account.address, seed);
    contracts.WeeklyQueuePlatform = await seedStage1(publicClient, send, contracts, account.address, seed);
  }

  const manifest: Manifest = {
    mode: "protocol",
    chainId: ARBITRUM_SEPOLIA,
    rpc,
    artifactRoot: protocolRoot,
    factory,
    contracts,
    roles: { deployer: account.address, governor: owners.governor, partnerA: owners.partnerA, partnerB: owners.partnerB },
  };
  writeManifest(manifest, manifestFile);
  return manifest;
}

function ownersFrom(parsed: SepoliaEnv, deployer: Address): ProtocolOwners {
  const partnerA = parsed.partnerA ?? deployer;
  const partnerB = parsed.partnerB ?? deployer;
  const fallback = partnerA.toLowerCase() === deployer.toLowerCase() ? partnerB : partnerA;
  const governor = parsed.governor ?? fallback;
  if (governor.toLowerCase() === deployer.toLowerCase()) {
    throw new HarnessError("Set GOVERNOR_ADDRESS to an account other than the deployer", "VALIDATION");
  }
  return { owner: deployer, governor, partnerA, partnerB };
}

function sepoliaChain(rpc: string): Chain {
  return {
    id: ARBITRUM_SEPOLIA,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  };
}

async function readChainId(rpc: string): Promise<number> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!response.ok) throw new HarnessError(`RPC returned HTTP ${response.status}`, "RPC");
  const body = await response.json() as { result?: string };
  if (!body.result) throw new HarnessError("RPC did not return a chain id", "RPC");
  return Number.parseInt(body.result, 16);
}
