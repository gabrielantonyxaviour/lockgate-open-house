import { createPublicClient, createWalletClient, getContractAddress, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadArtifact, protocolRoot } from "./artifacts.js";
import { protocolPlan, type ProtocolOwners } from "./deploy.js";
import { HarnessError } from "./errors.js";
import { ARBITRUM_ONE, ARBITRUM_SEPOLIA, PAXOS_USDG_SEPOLIA, assertSepoliaBroadcast } from "./guards.js";
import { writeManifest, type Manifest } from "./manifest.js";
import { usdg } from "./units.js";

const DEFAULT_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

/**
 * Deploys the protocol when the allow flag, a 32-byte key, and chain 421614 are all present.
 * Arbitrum One is refused before any transaction. Tests pass a local RPC. This module does not
 * broadcast on import, and it does not read the public endpoint unless the flag is already set.
 */
export async function broadcastSepolia(env: NodeJS.ProcessEnv, manifestFile: string): Promise<Manifest> {
  if (env.LOCKGATE_ALLOW_SEPOLIA_DEPLOY !== "1") {
    throw new HarnessError("Sepolia broadcast is blocked until LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1", "SEPOLIA_BLOCKED");
  }
  const rpc = env.SEPOLIA_RPC ?? DEFAULT_RPC;
  const chainId = await readChainId(rpc);
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  const key = assertSepoliaBroadcast(chainId, env);
  const account = privateKeyToAccount(key);
  const chain = sepoliaChain(rpc);
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  const factory = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
  const owners = ownersFrom(env, account.address);
  const external = env.USE_PAXOS_USDG === "1" ? PAXOS_USDG_SEPOLIA as Address : undefined;
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
  const reserveAbi = loadArtifact("PlatformReserve").abi;
  const wire = async (functionName: string, args: readonly unknown[]) => {
    const hash = await wallet.writeContract({ address: reserve, abi: reserveAbi, functionName, args, account, chain });
    await publicClient.waitForTransactionReceipt({ hash });
  };
  await wire("setCreditLine", [line]);
  await wire("setSlasher", [line, true]);
  if (!external) {
    const token = loadArtifact("MockUSDG");
    const hash = await wallet.writeContract({
      address: contracts.MockUSDG as Address, abi: token.abi, functionName: "mint", args: [account.address, usdg(1_000_000n)], account, chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
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

function ownersFrom(env: NodeJS.ProcessEnv, deployer: Address): ProtocolOwners {
  const partnerA = addressOr(env.PARTNER_A_ADDRESS, deployer);
  const partnerB = addressOr(env.PARTNER_B_ADDRESS, deployer);
  const fallback = partnerA.toLowerCase() === deployer.toLowerCase() ? partnerB : partnerA;
  const governor = addressOr(env.GOVERNOR_ADDRESS, fallback);
  if (governor.toLowerCase() === deployer.toLowerCase()) {
    throw new HarnessError("Set GOVERNOR_ADDRESS to an account other than the deployer", "VALIDATION");
  }
  return { owner: deployer, governor, partnerA, partnerB };
}

function addressOr(value: string | undefined, fallback: Address): Address {
  if (!value) return fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new HarnessError("Address must be 20 bytes", "VALIDATION");
  return value as Address;
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
  if (!response.ok) throw new HarnessError(`RPC ${rpc} returned ${response.status}`, "RPC");
  const body = await response.json() as { result?: string };
  if (!body.result) throw new HarnessError("RPC did not return a chain id", "RPC");
  return Number.parseInt(body.result, 16);
}
