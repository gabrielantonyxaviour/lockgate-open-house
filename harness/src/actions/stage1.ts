import { type Address } from "viem";
import { deployNew, read, send, warpTo, type Ctx } from "../chain.js";
import { HarnessError } from "../errors.js";
import { formatUsdg, parseBps, parseUsdg } from "../units.js";
import { ROLES } from "../roles.js";
import { DEMO } from "../params.js";
import { approve, balanceOf, navOf, platformLogical, remember, wholeShares } from "./common.js";

type Quote = { fee: bigint; feeBps: number; available: boolean; reason: string };
type RequestView = { navValue: bigint; status: number; advanceId: bigint };
type AdvanceView = { principal: bigint; fee: bigint; dueAt: bigint; status: number; to: Address };

const LABELS = ["", "Kasu Weekly (demo)", "Epoch Pool (demo)", "Quarterly Gated (demo)"];
const INTERVALS = [0, DEMO.weeklyInterval, DEMO.epochInterval, DEMO.quarterlyInterval];

export async function registerPlatform(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const kind = Number(input.kind ?? "1");
  const logical = platformLogical(kind);
  if (ctx.manifest.contracts[logical]) return { logical, address: ctx.manifest.contracts[logical], existing: true };
  const interval = INTERVALS[kind] ?? 0;
  if (!LABELS[kind] || interval === 0) throw new HarnessError("kind must be 1 weekly, 2 epoch, or 3 quarterly", "VALIDATION");
  const initialShares = input.initialShares && input.initialShares !== "0" ? wholeShares(input.initialShares, "1") : 0n;
  if (input.viaFactory === "true") {
    if (initialShares > 0n) {
      throw new HarnessError("factory clones start with zero shares; unbacked shares use direct CREATE", "VALIDATION");
    }
    return registerClone(ctx, kind, logical, interval, input);
  }
  const address = await deployNew(ctx, "platform", logical, [{
    token: ctx.binding("MockUSDG").address,
    creditLine: ctx.binding("LockgateCreditLine").address,
    reserve: ctx.binding("PlatformReserve").address,
    issuer: ROLES.platform.address,
    name: LABELS[kind],
    nav: DEMO.nav,
    interval: BigInt(interval),
    initialHolder: initialShares > 0n ? ROLES.investor.address : ROLES.platform.address,
    initialShares,
  }]);
  await send(ctx, "lockgate", "LockgateCreditLine", "registerSource", [
    address,
    parseUsdg(input.limitUsdg ?? "25000"),
    parseBps(input.reserveBps ?? "750"),
  ]);
  remember(ctx, logical, address);
  return { logical, address, kind };
}

export async function postReserve(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const amount = parseUsdg(input.amountUsdg ?? "2000");
  await approve(ctx, "platform", "LockgateCreditLine", amount);
  const hash = await send(ctx, "platform", "LockgateCreditLine", "postReserve", [ctx.binding(logical).address, amount]);
  return { hash, amount: amount.toString() };
}

export async function depositCapital(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const amount = parseUsdg(input.amountUsdg ?? "100000");
  await approve(ctx, "lockgate", "LockgateCreditLine", amount);
  const hash = await send(ctx, "lockgate", "LockgateCreditLine", "depositCapital", [amount]);
  return { hash, amount: amount.toString() };
}

export async function quote(ctx: Ctx, input: Record<string, string>): Promise<Quote & { nav: string }> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const nav = parseUsdg(input.navUsdg ?? "1000");
  const quoted = asQuote(await read(ctx, "LockgateCreditLine", "quote", [ctx.binding(logical).address, nav]));
  return { ...quoted, nav: nav.toString() };
}

export async function buyShares(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const shares = wholeShares(input.shares, "100");
  const cost = navOf(shares);
  await approve(ctx, "investor", logical, cost);
  const hash = await send(ctx, "investor", logical, "deposit", [cost]);
  return { hash, shares: shares.toString(), cost: cost.toString() };
}

export async function requestRedeem(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const shares = wholeShares(input.shares, "100");
  const hash = await send(ctx, "investor", logical, "requestRedeem", [shares]);
  const id = await read<bigint>(ctx, logical, "requestCount");
  return { hash, requestId: id.toString(), nav: navOf(shares).toString() };
}

export async function exitNow(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const shares = wholeShares(input.shares, "1000");
  const before = await balanceOf(ctx, ROLES.investor.address);
  const hash = await send(ctx, "investor", logical, "exitNow", [shares, parseUsdg(input.minUsdg ?? "0")]);
  const requestId = await read<bigint>(ctx, logical, "requestCount");
  const request = asRequest(await read(ctx, logical, "getRequest", [requestId]));
  const after = await balanceOf(ctx, ROLES.investor.address);
  return {
    hash,
    requestId: requestId.toString(),
    advanceId: request.advanceId.toString(),
    nav: request.navValue.toString(),
    received: (after - before).toString(),
  };
}

export async function draw(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  return exitNow(ctx, input);
}

export async function depositCash(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const amount = parseUsdg(input.amountUsdg ?? "1000");
  await approve(ctx, "platform", logical, amount);
  const hash = await send(ctx, "platform", logical, "depositCash", [amount]);
  return { hash, amount: amount.toString() };
}

export async function processWindow(ctx: Ctx, input: Record<string, string> = {}): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const next = await read<bigint>(ctx, logical, "nextWindow");
  await warpTo(ctx, next);
  const block = await ctx.publicClient.getBlock();
  if (block.timestamp < next) await warpTo(ctx, next + 1n);
  const hash = await send(ctx, "platform", logical, "processWindow", []);
  const rolled = await read<bigint>(ctx, logical, "nextWindow");
  return { hash, nextWindow: rolled.toString() };
}

export async function repay(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const advanceId = BigInt(input.advanceId ?? "1");
  const remaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
  await depositCash(ctx, { platform: logical, amountUsdg: formatUsdg(remaining) });
  const processed = await processWindow(ctx, { platform: logical });
  const left = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
  return { processed, remaining: left.toString() };
}

export async function markLate(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const advanceId = BigInt(input.advanceId ?? "1");
  if (input.warp !== "false") {
    const advance = asAdvance(await read(ctx, "LockgateCreditLine", "getAdvance", [advanceId]));
    const grace = await read<bigint>(ctx, "LockgateCreditLine", "grace");
    await warpTo(ctx, advance.dueAt + grace + 1n);
  }
  const hash = await send(ctx, "lockgate", "LockgateCreditLine", "markLate", [advanceId]);
  const remaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
  const advance = asAdvance(await read(ctx, "LockgateCreditLine", "getAdvance", [advanceId]));
  return { hash, status: advance.status, remaining: remaining.toString(), principal: advance.principal.toString() };
}

export async function setGated(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const logical = input.platform ?? "WeeklyQueuePlatform";
  const gated = input.gated !== "false";
  const hash = await send(ctx, "platform", logical, "setGated", [gated]);
  return { hash, gated };
}

export async function pauseLine(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const paused = input.paused !== "false";
  const hash = await send(ctx, "lockgate", "LockgateCreditLine", paused ? "pause" : "unpause", []);
  return { hash, paused };
}

export async function requestView(ctx: Ctx, logical: string, id: bigint): Promise<RequestView> {
  return asRequest(await read(ctx, logical, "getRequest", [id]));
}

function asQuote(value: unknown): Quote {
  const parts = list(value);
  if (parts.length >= 4) {
    return { fee: BigInt(parts[0] as bigint), feeBps: Number(parts[1]), available: Boolean(parts[2]), reason: String(parts[3]) };
  }
  const row = value as Quote;
  return { fee: BigInt(row.fee), feeBps: Number(row.feeBps), available: Boolean(row.available), reason: String(row.reason) };
}

function asRequest(value: unknown): RequestView {
  const row = value as { navValue?: bigint; status?: number; advanceId?: bigint };
  if (row && typeof row === "object" && "navValue" in row) {
    return { navValue: BigInt(row.navValue ?? 0), status: Number(row.status), advanceId: BigInt(row.advanceId ?? 0) };
  }
  const parts = list(value);
  return { navValue: BigInt(parts[2] as bigint), status: Number(parts[4]), advanceId: BigInt(parts[5] as bigint) };
}

function asAdvance(value: unknown): AdvanceView {
  const row = value as Partial<AdvanceView>;
  if (row && typeof row === "object" && "principal" in row) {
    return {
      principal: BigInt(row.principal ?? 0), fee: BigInt(row.fee ?? 0), dueAt: BigInt(row.dueAt ?? 0),
      status: Number(row.status), to: (row.to ?? "0x0000000000000000000000000000000000000000") as Address,
    };
  }
  const parts = list(value);
  return {
    to: parts[1] as Address, principal: BigInt(parts[2] as bigint), fee: BigInt(parts[3] as bigint),
    dueAt: BigInt(parts[5] as bigint), status: Number(parts[6]),
  };
}

const IMPL = ["", "WeeklyImpl", "EpochImpl", "QuarterImpl"];

async function registerClone(
  ctx: Ctx,
  kind: number,
  logical: string,
  interval: number,
  input: Record<string, string>,
): Promise<unknown> {
  await send(ctx, "platform", "FundFactory", "createPlatform", [
    kind,
    LABELS[kind],
    BigInt(interval),
    DEMO.nav,
    parseUsdg(input.limitUsdg ?? "25000"),
    parseBps(input.reserveBps ?? "750"),
  ]);
  const funds = await read<readonly Address[]>(ctx, "FundFactory", "fundsOf", [ROLES.platform.address]);
  const address = funds[funds.length - 1];
  if (!address) throw new HarnessError("factory returned no platform", "DEPLOY_FAILED");
  const impl = ctx.binding(IMPL[kind] ?? "").address;
  if (address.toLowerCase() === impl.toLowerCase()) {
    throw new HarnessError("clone matched the locked implementation", "DEPLOY_MISMATCH");
  }
  remember(ctx, logical, address);
  return { logical, address, kind, viaFactory: true };
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => /^\d+$/.test(key));
    if (keys.length > 0) return keys.sort((a, b) => Number(a) - Number(b)).map((key) => record[key]);
  }
  return [];
}

