import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { repoRoot } from "./artifacts.js";
import { deploymentManifestPath } from "./deployment-manifest.js";
import { failureBody, HarnessError, isTimeout } from "./errors.js";
import { ANVIL_CHAIN_ID, ARBITRUM_ONE, ARBITRUM_SEPOLIA, assertHarnessWrite, RPC_TIMEOUT_MS } from "./guards.js";
import { parseLocalDeployEnv } from "./input.js";
import { manifestPath } from "./manifest.js";
import { cursorPath } from "./progress.js";

const NAME = /^[A-Za-z0-9._-]+\.json$/;
const SEPOLIA_NAMES = new Set([
  basename(manifestPath(ARBITRUM_SEPOLIA)),
  basename(cursorPath(manifestPath(ARBITRUM_SEPOLIA))),
  basename(deploymentManifestPath(ARBITRUM_SEPOLIA)),
]);

export type CleanupReport = {
  ok: true;
  chainId: number;
  reset: true;
  removed: string[];
};

export type CleanupIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  root?: string;
  chainId?: () => Promise<number>;
  reset?: () => Promise<void>;
};

function deploymentsDir(): string {
  return join(repoRoot, "harness", "deployments");
}

function defaultNames(): string[] {
  const manifest = manifestPath(ANVIL_CHAIN_ID);
  return [basename(manifest), basename(cursorPath(manifest)), basename(deploymentManifestPath(ANVIL_CHAIN_ID))];
}

/** The real deployments directory. A symlink is refused before any RPC call. */
export function openDeployments(override?: string): string | undefined {
  const dir = override ?? deploymentsDir();
  let info;
  try {
    info = lstatSync(dir);
  } catch {
    return undefined;
  }
  if (info.isSymbolicLink()) throw new HarnessError("Cleanup refuses a symlinked deployments directory", "VALIDATION");
  if (!info.isDirectory()) throw new HarnessError("Cleanup deployments path is not a directory", "VALIDATION");
  const real = realpathSync(dir);
  if (override === undefined && real !== resolve(deploymentsDir())) {
    throw new HarnessError("Cleanup refuses a deployments path outside the harness", "VALIDATION");
  }
  return real;
}

function place(root: string, manifestFile: string): string {
  const abs = resolve(manifestFile);
  let realDir: string;
  try {
    realDir = realpathSync(dirname(abs));
  } catch {
    throw new HarnessError("Cleanup only removes manifests inside harness/deployments", "VALIDATION");
  }
  if (realDir !== root) throw new HarnessError("Cleanup only removes manifests inside harness/deployments", "VALIDATION");
  const name = basename(abs);
  if (!NAME.test(name)) throw new HarnessError("Cleanup manifest name is invalid", "VALIDATION");
  if (SEPOLIA_NAMES.has(name)) throw new HarnessError("Cleanup does not remove the Sepolia manifest", "VALIDATION");
  return name;
}

function tempName(name: string, bases: readonly string[]): boolean {
  return bases.some((base) => name.startsWith(`${base}.`) && /^\d+\.tmp$/.test(name.slice(base.length + 1)));
}

function candidates(root: string | undefined, manifestFile?: string): string[] {
  const names = new Set(defaultNames());
  if (manifestFile) {
    if (!root) throw new HarnessError("Cleanup deployments directory is missing", "VALIDATION");
    const name = place(root, manifestFile);
    names.add(name);
    names.add(basename(cursorPath(name)));
  }
  if (!root) return [...names].sort();
  let listed: string[] = [];
  try {
    listed = readdirSync(root);
  } catch {
    listed = [];
  }
  const bases = [...names];
  for (const name of listed) {
    if (tempName(name, bases)) names.add(name);
  }
  return [...names].sort();
}

function assertPlainFiles(root: string, names: readonly string[]): void {
  for (const name of names) {
    const path = join(root, name);
    let info;
    try {
      info = lstatSync(path);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) throw new HarnessError("Cleanup refuses a symlink in deployments", "VALIDATION");
    if (!info.isFile()) throw new HarnessError("Cleanup refuses a non-file in deployments", "VALIDATION");
  }
}

async function rpcCall(rpc: string, method: string, params: readonly unknown[]): Promise<{ result?: unknown; error?: unknown }> {
  let response: Response;
  try {
    response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) throw new HarnessError("RPC timed out", "RPC");
    throw new HarnessError("RPC is unreachable", "RPC");
  }
  if (!response.ok) throw new HarnessError(`RPC returned HTTP ${response.status}`, "RPC");
  return await response.json() as { result?: unknown; error?: unknown };
}

async function fetchChainId(rpc: string): Promise<number> {
  const body = await rpcCall(rpc, "eth_chainId", []);
  const result = body.result;
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new HarnessError("RPC did not return a chain id", "RPC");
  }
  return Number.parseInt(result, 16);
}

/** Empty parameters only. A forking object would point Anvil at another chain. */
async function resetAnvil(rpc: string): Promise<void> {
  const body = await rpcCall(rpc, "anvil_reset", []);
  if (body.error !== undefined) throw new HarnessError("Anvil reset was refused", "RPC");
  if (!("result" in body)) throw new HarnessError("RPC response has no result", "RPC");
}

function removeNames(root: string, names: readonly string[]): string[] {
  const removed: string[] = [];
  for (const name of names) {
    const path = join(root, name);
    let info;
    try {
      info = lstatSync(path);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) throw new HarnessError("Cleanup refuses a symlink in deployments", "VALIDATION");
    if (!info.isFile()) throw new HarnessError("Cleanup refuses a non-file in deployments", "VALIDATION");
    rmSync(path);
    removed.push(name);
  }
  return removed;
}

export async function runCleanup(env: NodeJS.ProcessEnv, io: Pick<CleanupIo, "root" | "chainId" | "reset"> = {}): Promise<CleanupReport> {
  const parsed = parseLocalDeployEnv(env);
  const root = openDeployments(io.root);
  const names = candidates(root, parsed.manifestFile);
  if (root) assertPlainFiles(root, names);
  const chainId = io.chainId ? await io.chainId() : await fetchChainId(parsed.rpc);
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  assertHarnessWrite(chainId);
  if (io.reset) await io.reset();
  else await resetAnvil(parsed.rpc);
  const removed = root ? removeNames(root, names) : [];
  return { ok: true, chainId, reset: true, removed };
}

export async function main(env: NodeJS.ProcessEnv, io: CleanupIo): Promise<number> {
  try {
    io.stdout(JSON.stringify(await runCleanup(env, io)));
    return 0;
  } catch (err: unknown) {
    io.stderr(JSON.stringify(failureBody(err)));
    return 1;
  }
}
