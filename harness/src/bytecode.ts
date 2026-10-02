import { type Address, type Hex } from "viem";
import { z } from "zod";
import { loadDeployedBytecode, type DeployedBytecode } from "./artifacts.js";
import { failureBody, HarnessError, isTimeout } from "./errors.js";
import { ANVIL_CHAIN_ID, ARBITRUM_ONE, assertHarnessWrite, assertLocalRpc, RPC_TIMEOUT_MS } from "./guards.js";
import { parseCliEnv } from "./input.js";
import { manifestPath, readManifest, type Manifest } from "./manifest.js";

/** Partner vault addresses hold the proxy, not the PartnerVault runtime. */
const PROXY_ARTIFACT: Record<string, string> = {
  PartnerVaultA: "ERC1967Proxy",
  PartnerVaultB: "ERC1967Proxy",
};

const codeSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);

export type BytecodeReport = {
  ok: true;
  chainId: number;
  compared: number;
  matched: number;
};

export type BytecodeIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  manifest?: Manifest;
  chainId?: () => Promise<number>;
  codeAt?: (address: Address) => Promise<Hex>;
};

function artifactName(logical: string): string {
  return PROXY_ARTIFACT[logical] ?? logical;
}

/** A missing build fails before any RPC call. */
function requireArtifacts(manifest: Manifest): void {
  for (const logical of Object.keys(manifest.contracts)) {
    loadDeployedBytecode(artifactName(logical));
  }
}

function mask(code: string, immutables: DeployedBytecode["immutables"]): string | null {
  const body = code.slice(2).toLowerCase();
  const chars = body.split("");
  for (const span of immutables) {
    const from = span.start * 2;
    const to = from + span.length * 2;
    if (to > chars.length) return null;
    for (let i = from; i < to; i += 1) chars[i] = "0";
  }
  return chars.join("");
}

function matches(onChain: Hex, artifact: DeployedBytecode): boolean {
  const left = mask(onChain, artifact.immutables);
  const right = mask(artifact.bytecode, artifact.immutables);
  return left !== null && left === right;
}

/** Compare each manifest address to the current artifact. Immutables are masked. */
export async function diffBytecode(
  manifest: Manifest,
  codeAt: (address: Address) => Promise<Hex>,
): Promise<BytecodeReport> {
  const entries = Object.entries(manifest.contracts);
  const artifacts = new Map<string, DeployedBytecode>();
  for (const [logical] of entries) artifacts.set(logical, loadDeployedBytecode(artifactName(logical)));
  const problems: string[] = [];
  for (const [logical, address] of entries) {
    const code = await codeAt(address as Address);
    const parsed = codeSchema.safeParse(code);
    if (!parsed.success || parsed.data === "0x") {
      problems.push(`${logical} has no code`);
      continue;
    }
    const artifact = artifacts.get(logical);
    if (!artifact || !matches(parsed.data as Hex, artifact)) problems.push(logical);
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 4);
    const extra = problems.length - shown.length;
    const tail = extra > 0 ? ` and ${extra} more` : "";
    throw new HarnessError(`Stale bytecode: ${shown.join(", ")}${tail}`, "STALE");
  }
  return { ok: true, chainId: manifest.chainId, compared: entries.length, matched: entries.length };
}

async function rpcCall(rpc: string, method: string, params: readonly unknown[]): Promise<unknown> {
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
  const body = await response.json() as { result?: unknown };
  if (body.result === undefined) throw new HarnessError("RPC response has no result", "RPC");
  return body.result;
}

async function fetchChainId(rpc: string): Promise<number> {
  const result = await rpcCall(rpc, "eth_chainId", []);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new HarnessError("RPC did not return a chain id", "RPC");
  }
  return Number.parseInt(result, 16);
}

async function fetchCode(rpc: string, address: Address): Promise<Hex> {
  const result = await rpcCall(rpc, "eth_getCode", [address, "latest"]);
  const parsed = codeSchema.safeParse(result);
  if (!parsed.success) throw new HarnessError("RPC did not return bytecode", "RPC");
  return parsed.data as Hex;
}

export async function runBytecode(env: NodeJS.ProcessEnv, io: Pick<BytecodeIo, "manifest" | "chainId" | "codeAt"> = {}): Promise<BytecodeReport> {
  const parsed = parseCliEnv(env);
  const manifest = io.manifest ?? readManifest(parsed.manifestFile ?? manifestPath(ANVIL_CHAIN_ID));
  if (parsed.rpc) manifest.rpc = parsed.rpc;
  assertLocalRpc(manifest.rpc);
  requireArtifacts(manifest);
  const chainId = io.chainId ? await io.chainId() : await fetchChainId(manifest.rpc);
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  assertHarnessWrite(chainId);
  if (chainId !== manifest.chainId) {
    throw new HarnessError(`RPC chain ${chainId} does not match manifest ${manifest.chainId}`, "CHAIN_REFUSED");
  }
  return diffBytecode(manifest, io.codeAt ?? ((address) => fetchCode(manifest.rpc, address)));
}

export async function main(env: NodeJS.ProcessEnv, io: BytecodeIo): Promise<number> {
  try {
    io.stdout(JSON.stringify(await runBytecode(env, io)));
    return 0;
  } catch (err: unknown) {
    io.stderr(JSON.stringify(failureBody(err)));
    return 1;
  }
}
