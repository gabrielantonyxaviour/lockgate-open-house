import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const RPC = "http://127.0.0.1:8545";
const U = 1_000_000n;
export const usd = (whole: bigint) => whole * U;

const anvil = defineChain({
  id: 31_337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

/** Public Anvil development keys. They are not secrets. */
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87292fc0d0e8",
] as const;

export const accounts = KEYS.map((key) => privateKeyToAccount(key));
export const [deployer, harbour, keppel, lockgate, platform, investor] = accounts;
export const proposerKey = KEYS[3];

export const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });

const wallets = new Map(accounts.map((account) => [account.address, createWalletClient({ account, chain: anvil, transport: http(RPC) })]));

export function fail(code: string, error: string): never {
  throw Object.assign(new Error(error), { error, code });
}

function collectArtifacts(dir: string, name: string, hits: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "build-info" || entry === "mocks") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectArtifacts(full, name, hits);
    else if (entry === `${name}.json` && full.includes(`${path.sep}${name}.sol${path.sep}`)) hits.push(full);
  }
}

function findArtifact(dir: string, name: string): string | undefined {
  const hits: string[] = [];
  collectArtifacts(dir, name, hits);
  const exact = `${path.sep}${name}.sol${path.sep}${name}.json`;
  return hits.find((hit) => hit.endsWith(exact)) ?? hits[0];
}

export function artifact(name: string): Abi {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/out");
  const hit = findArtifact(root, name);
  if (!hit) fail("artifact", `missing forge artifact ${name}`);
  return JSON.parse(readFileSync(hit, "utf8")).abi as Abi;
}

export function bytecode(name: string): Hex {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/out");
  const hit = findArtifact(root, name);
  if (!hit) fail("artifact", `missing forge artifact ${name}`);
  return JSON.parse(readFileSync(hit, "utf8")).bytecode.object as Hex;
}

export async function deploy(name: string, args: unknown[], account: PrivateKeyAccount = deployer): Promise<Address> {
  const hash = await wallets.get(account.address)!.deployContract({
    abi: artifact(name),
    bytecode: bytecode(name),
    args,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) fail("deploy", `${name} failed`);
  return receipt.contractAddress;
}

export async function send(
  name: string,
  address: Address,
  functionName: string,
  args: unknown[],
  account: PrivateKeyAccount,
): Promise<void> {
  const hash = await wallets.get(account.address)!.writeContract({
    address,
    abi: artifact(name),
    functionName,
    args,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail("tx", `${name}.${functionName} reverted`);
}

export async function read<T>(name: string, address: Address, functionName: string, args: unknown[] = []): Promise<T> {
  return publicClient.readContract({ address, abi: artifact(name), functionName, args }) as Promise<T>;
}

export async function reverts(
  name: string,
  address: Address,
  functionName: string,
  args: unknown[],
  account: PrivateKeyAccount,
): Promise<boolean> {
  try {
    await wallets.get(account.address)!.simulateContract({
      address,
      abi: artifact(name),
      functionName,
      args,
      account,
    });
    return false;
  } catch {
    return true;
  }
}
