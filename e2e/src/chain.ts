import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
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

const PRIVATE_OUT = "/tmp/lockgate-g9/forge-out";
const artifactFiles = new Map<string, string>();
const sourceStamps = new Map<string, number>();

function newestSolidity(dir: string): number {
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    if (entry === "out" || entry === "cache") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) max = Math.max(max, newestSolidity(full));
    else if (entry.endsWith(".sol")) max = Math.max(max, stat.mtimeMs);
  }
  return max;
}

/** Newest Solidity file under `src/` or `lib/`. One contract file is not enough. */
export function solidityTreeMtime(root: string): number {
  const cached = sourceStamps.get(root);
  if (cached !== undefined) return cached;
  const stamp = Math.max(newestSolidity(path.join(root, "src")), newestSolidity(path.join(root, "lib")));
  sourceStamps.set(root, stamp);
  return stamp;
}

/** A transport or ABI failure is not a revert. Callers must not treat it as success. */
export function isContractRevert(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  if (err.walk((item) => item instanceof ContractFunctionRevertedError)) return true;
  return err.message.toLowerCase().includes("reverted");
}

function contractsRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts");
}

function findSource(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const nested = findSource(full, name);
      if (nested) return nested;
    } else if (entry === `${name}.sol`) return full;
  }
  return undefined;
}

/** `out/<Name>.sol` collides when a test mock shares the file name. Read `src/` from a private build. */
function srcArtifact(name: string): string | undefined {
  const root = contractsRoot();
  const source = findSource(path.join(root, "src"), name);
  if (!source) return undefined;
  const dest = path.join(PRIVATE_OUT, `${name}.sol`, `${name}.json`);
  const stale = !existsSync(dest) || statSync(dest).mtimeMs < solidityTreeMtime(root);
  if (stale) {
    execFileSync("forge", ["inspect", `${path.relative(root, source)}:${name}`, "abi", "--json"], {
      cwd: root,
      env: { ...process.env, FOUNDRY_OUT: PRIVATE_OUT },
      stdio: "pipe",
    });
  }
  return dest;
}

function artifactFile(name: string): string {
  const cached = artifactFiles.get(name);
  if (cached) return cached;
  const src = srcArtifact(name);
  const hit = src ?? findArtifact(path.join(contractsRoot(), "out"), name);
  if (!hit) fail("artifact", `missing forge artifact ${name}`);
  artifactFiles.set(name, hit);
  return hit;
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
  return JSON.parse(readFileSync(artifactFile(name), "utf8")).abi as Abi;
}

export function bytecode(name: string): Hex {
  return JSON.parse(readFileSync(artifactFile(name), "utf8")).bytecode.object as Hex;
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
    await publicClient.simulateContract({
      address,
      abi: artifact(name),
      functionName,
      args,
      account,
    });
    return false;
  } catch (err) {
    if (isContractRevert(err)) return true;
    const message = err instanceof Error ? err.message : "call failed";
    fail("rpc", `${name}.${functionName} did not revert: ${message}`);
  }
}
