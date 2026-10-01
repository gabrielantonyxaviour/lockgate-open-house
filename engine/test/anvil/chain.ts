import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/** Public Anvil development keys. They are not secrets. */
export const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
] as const;

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), "../../../contracts");
const SHARED_ANVIL_PID = 53114;

/** Source-pinned ids. `out/MockUSDG.sol` collides with a test mock, so the token is not loaded by name. */
const SOURCE: Record<string, string> = {
  MockUSDG: "src/core/MockUSDG.sol:MockUSDG",
  UsdgAdapter: "src/core/UsdgAdapter.sol:UsdgAdapter",
  PricingEngine: "src/core/PricingEngine.sol:PricingEngine",
  PlatformReserve: "src/core/PlatformReserve.sol:PlatformReserve",
  LockgateCreditLine: "src/core/LockgateCreditLine.sol:LockgateCreditLine",
  FundFactory: "src/core/FundFactory.sol:FundFactory",
  PartnerVault: "src/partner/PartnerVault.sol:PartnerVault",
  CreditFacility: "src/facility/CreditFacility.sol:CreditFacility",
  WeeklyCyclePlatform: "src/core/WeeklyCyclePlatform.sol:WeeklyCyclePlatform",
};

const compiled = new Map<string, { abi: Abi; bytecode: Hex }>();

export type Anvil = {
  port: number;
  pid: number;
  chain: ReturnType<typeof defineChain>;
  publicClient: PublicClient;
  account: (index: number) => PrivateKeyAccount;
  wallet: (index: number) => WalletClient;
  stop: () => void;
};

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const cached = compiled.get(name);
  if (cached) return cached;
  const id = SOURCE[name];
  const row = id ? inspected(id) : fromOut(name);
  compiled.set(name, row);
  return row;
}

function inspected(id: string): { abi: Abi; bytecode: Hex } {
  return { abi: JSON.parse(forgeField(id, "abi")) as Abi, bytecode: forgeField(id, "bytecode") as Hex };
}

function fromOut(name: string): { abi: Abi; bytecode: Hex } {
  const path = join(CONTRACTS, "out", `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function forgeField(id: string, field: string): string {
  let out = "";
  try {
    out = execFileSync("forge", ["inspect", id, field, "--json"], {
      cwd: CONTRACTS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    throw new Error(`forge inspect ${id} ${field} failed ${stderr}`);
  }
  if (field === "bytecode" && out.startsWith('"')) return JSON.parse(out) as string;
  return out;
}

export async function deploy(node: Anvil, from: number, name: string, args: readonly unknown[]): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const hash = await node.wallet(from).deployContract({
    abi,
    bytecode,
    args: args as never,
    account: node.account(from),
    chain: node.chain,
  });
  const receipt = await node.publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`${name} was not deployed`);
  return receipt.contractAddress;
}

export async function send(
  node: Anvil,
  from: number,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<void> {
  const hash = await node.wallet(from).writeContract({
    address,
    abi,
    functionName,
    args: args as never,
    account: node.account(from),
    chain: node.chain,
  });
  const receipt = await node.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
}

export async function read<T>(
  node: Anvil,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return node.publicClient.readContract({
    address,
    abi,
    functionName,
    args: args as never,
  }) as Promise<T>;
}

export async function raw(node: Anvil, from: number, to: Address, data: Hex): Promise<Hex> {
  const hash = await node.wallet(from).sendTransaction({
    to,
    data,
    account: node.account(from),
    chain: node.chain,
  });
  const receipt = await node.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("transaction reverted");
  return hash;
}

/** The next transaction is mined at `timestamp`. Does not mine an empty block. */
export async function stamp(node: Anvil, timestamp: number): Promise<void> {
  await node.publicClient.request({
    method: "evm_setNextBlockTimestamp",
    params: [`0x${timestamp.toString(16)}`],
  } as never);
}

export async function startAnvil(): Promise<Anvil> {
  const port = await pickPort(8546);
  const child = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--accounts", "10", "--balance", "10000", "--disable-code-size-limit"],
    { detached: true, stdio: "ignore" },
  );
  const pid = child.pid;
  if (!pid || pid === SHARED_ANVIL_PID) {
    child.kill("SIGTERM");
    throw new Error("anvil did not start as a new process");
  }
  try {
    await waitForChain(port);
  } catch (err) {
    stopPid(pid);
    throw err;
  }
  const rpc = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const accounts = KEYS.map((key) => privateKeyToAccount(key));
  const wallets = accounts.map((account) => createWalletClient({ account, chain, transport: http(rpc) }));
  return {
    port,
    pid,
    chain,
    publicClient,
    account: (index) => accounts[index]!,
    wallet: (index) => wallets[index]!,
    stop: () => stopPid(pid),
  };
}

function stopPid(pid: number): void {
  if (pid === SHARED_ANVIL_PID) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
  }
}

async function pickPort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port += 1) {
    if (await free(port)) return port;
  }
  throw new Error("no free local port from 8546");
}

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function waitForChain(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const body = await response.json() as { result?: string };
      if (body.result === "0x7a69") return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`anvil on ${port} did not answer chain id 31337`);
}
