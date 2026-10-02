import { createPublicClient, decodeEventLog, formatEther, http, type Abi, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { z } from "zod";
import { loadArtifact } from "./artifacts.js";
import { explain, loadCtx, read, type Ctx } from "./chain.js";
import { failureBody, HarnessError } from "./errors.js";
import { ANVIL_CHAIN_ID, ARBITRUM_ONE, assertHarnessWrite, assertLocalRpc, RPC_TIMEOUT_MS } from "./guards.js";
import { parseCliEnv } from "./input.js";
import { manifestPath, readManifest, type Manifest } from "./manifest.js";
import { endpointOf, formatEventArgs, renderReport, tenorOf, type ReportContract, type ReportEvent, type ReportMandate, type StateReport } from "./report-screen.js";
import { ROLES, type RoleName } from "./roles.js";
import { formatUsdg } from "./units.js";

export { formatEventArgs, renderReport } from "./report-screen.js";
export type { ReportContract, ReportEvent, ReportMandate, StateReport } from "./report-screen.js";

const EVENT_CAP = 6;
const LOOKBACK = 500n;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const mandateSchema = z.object({
  signer: address,
  minFeeBps: z.number().int().nonnegative(),
  maxTenor: z.bigint().nonnegative(),
  concentrationBps: z.number().int().nonnegative(),
  expiry: z.bigint().nonnegative(),
});

export type ReportIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  manifest?: Manifest;
  chainId?: () => Promise<number>;
  report?: () => Promise<StateReport>;
};

type Mandate = z.infer<typeof mandateSchema>;

export async function collectReport(ctx: Ctx): Promise<StateReport> {
  const block = await ctx.publicClient.getBlockNumber();
  const contracts = await deployed(ctx);
  return {
    chainId: ctx.chainId,
    block: block.toString(),
    mode: ctx.manifest.mode,
    endpoint: endpointOf(ctx.manifest.rpc),
    contracts,
    balances: await balanceLines(ctx),
    line: await lineLine(ctx),
    mandates: await mandateLines(ctx),
    events: await recentEvents(ctx, contracts, block),
  };
}

/** Read the local manifest and render one screen. A public host is refused first. */
export async function runReport(env: NodeJS.ProcessEnv, io: Pick<ReportIo, "manifest" | "chainId" | "report"> = {}): Promise<string> {
  const parsed = parseCliEnv(env);
  const manifest = io.manifest ?? readManifest(parsed.manifestFile ?? manifestPath(ANVIL_CHAIN_ID));
  if (parsed.rpc) manifest.rpc = parsed.rpc;
  assertLocalRpc(manifest.rpc);
  for (const logical of Object.keys(manifest.contracts)) loadArtifact(logical);
  const chainId = io.chainId ? await io.chainId() : await fetchChainId(manifest.rpc);
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  assertHarnessWrite(chainId);
  if (chainId !== manifest.chainId) {
    throw new HarnessError(`RPC chain ${chainId} does not match manifest ${manifest.chainId}`, "CHAIN_REFUSED");
  }
  if (io.report) return renderReport(await io.report());
  const ctx = await loadCtx(manifest, parsed.manifestFile ?? "");
  return renderReport(await collectReport(ctx));
}

export async function main(env: NodeJS.ProcessEnv, io: ReportIo): Promise<number> {
  try {
    io.stdout(await runReport(env, io));
    return 0;
  } catch (err: unknown) {
    io.stderr(JSON.stringify(failureBody(err)));
    return 1;
  }
}

async function deployed(ctx: Ctx): Promise<ReportContract[]> {
  const rows: ReportContract[] = [];
  for (const name of Object.keys(ctx.manifest.contracts).sort()) {
    const itemAddress = ctx.manifest.contracts[name] as Address;
    const code = await ctx.publicClient.getBytecode({ address: itemAddress });
    rows.push({ name, address: itemAddress, code: Boolean(code && code !== "0x") });
  }
  return rows;
}

async function balanceLines(ctx: Ctx): Promise<string[]> {
  if (!ctx.manifest.contracts.MockUSDG) return ["no MockUSDG"];
  const parts: string[] = [];
  for (const role of Object.keys(ROLES) as RoleName[]) {
    parts.push(`${role} ${await usdgOf(ctx, ROLES[role].address)}`);
  }
  const eth = formatEther(await ctx.publicClient.getBalance({ address: ROLES.lockgate.address }));
  return [parts.slice(0, 4).join("  "), parts.slice(4).join("  "), `lockgateEth ${eth}`];
}

async function lineLine(ctx: Ctx): Promise<string> {
  if (!ctx.manifest.contracts.LockgateCreditLine) return "no credit line";
  const capital = await lineUsdg(ctx, "capital");
  const outstanding = await lineUsdg(ctx, "outstanding");
  const paused = await lineBool(ctx);
  return `capital ${capital}  outstanding ${outstanding}  paused ${paused}`;
}

async function mandateLines(ctx: Ctx): Promise<ReportMandate[]> {
  const rows: ReportMandate[] = [];
  for (const vault of ["PartnerVaultA", "PartnerVaultB"]) {
    if (!ctx.manifest.contracts[vault]) continue;
    rows.push({ vault, text: await mandateText(ctx, vault) });
  }
  return rows;
}

async function mandateText(ctx: Ctx, vault: string): Promise<string> {
  let value: unknown;
  try {
    value = await read(ctx, vault, "mandate");
  } catch (err: unknown) {
    return revertOrThrow(err);
  }
  const parsed = mandateSchema.safeParse(normalizeMandate(value));
  if (!parsed.success) return "unreadable";
  if (parsed.data.expiry === 0n) return "none";
  const row = parsed.data;
  return `minFee ${row.minFeeBps}bps  tenor ${tenorOf(row.maxTenor)}  conc ${row.concentrationBps}bps  exp ${row.expiry}  signer ${row.signer}`;
}

async function recentEvents(ctx: Ctx, contracts: readonly ReportContract[], block: bigint): Promise<ReportEvent[]> {
  const live = contracts.filter((item) => item.code);
  if (live.length === 0) return [];
  const from = block > LOOKBACK ? block - LOOKBACK : 0n;
  let logs;
  try {
    logs = await ctx.publicClient.getLogs({
      address: live.map((item) => item.address as Address),
      fromBlock: from,
      toBlock: block,
    });
  } catch (err: unknown) {
    revertOrThrow(err);
    return [];
  }
  const names = new Map(live.map((item) => [item.address.toLowerCase(), item.name]));
  const ordered = [...logs].sort((left, right) => {
    const delta = (left.blockNumber ?? 0n) - (right.blockNumber ?? 0n);
    if (delta !== 0n) return delta < 0n ? -1 : 1;
    return (left.logIndex ?? 0) - (right.logIndex ?? 0);
  });
  return ordered.flatMap((log) => {
    const name = names.get(log.address.toLowerCase());
    return name ? [decodeOne(name, log)] : [];
  }).slice(-EVENT_CAP);
}

function decodeOne(contract: string, log: { blockNumber: bigint | null; data: Hex; topics: readonly Hex[] }): ReportEvent {
  const block = (log.blockNumber ?? 0n).toString();
  if (log.topics.length === 0) return { block, contract, name: "undecoded", args: "" };
  try {
    const decoded = decodeEventLog({
      abi: loadArtifact(contract).abi as Abi,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    return { block, contract, name: decoded.eventName ?? "undecoded", args: formatEventArgs(decoded.args) };
  } catch {
    return { block, contract, name: "undecoded", args: "" };
  }
}

function normalizeMandate(value: unknown): Mandate | null {
  const row = Array.isArray(value)
    ? { signer: value[1], minFeeBps: value[2], maxTenor: value[3], concentrationBps: value[4], expiry: value[5] }
    : value as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;
  const minFeeBps = asNumber(row.minFeeBps);
  const concentrationBps = asNumber(row.concentrationBps);
  const maxTenor = asBigint(row.maxTenor);
  const expiry = asBigint(row.expiry);
  if (minFeeBps === null || concentrationBps === null || maxTenor === null || expiry === null) return null;
  return { signer: String(row.signer), minFeeBps, maxTenor, concentrationBps, expiry };
}

async function fetchChainId(rpc: string): Promise<number> {
  const client = createPublicClient({ chain: foundry, transport: http(rpc, { retryCount: 0, timeout: RPC_TIMEOUT_MS }) });
  try {
    return await client.getChainId();
  } catch (err: unknown) {
    throw explain(err);
  }
}

async function usdgOf(ctx: Ctx, account: Address): Promise<string> {
  try {
    return formatUsdg(await read<bigint>(ctx, "MockUSDG", "balanceOf", [account]));
  } catch (err: unknown) {
    return revertOrThrow(err);
  }
}

async function lineUsdg(ctx: Ctx, fn: string): Promise<string> {
  try {
    return formatUsdg(await read<bigint>(ctx, "LockgateCreditLine", fn));
  } catch (err: unknown) {
    return revertOrThrow(err);
  }
}

async function lineBool(ctx: Ctx): Promise<string> {
  try {
    return (await read<boolean>(ctx, "LockgateCreditLine", "paused")) ? "true" : "false";
  } catch (err: unknown) {
    return revertOrThrow(err);
  }
}

function revertOrThrow(err: unknown): string {
  const explained = explain(err);
  if (explained.code !== "REVERT") throw explained;
  return "unreadable";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function asBigint(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  return null;
}
