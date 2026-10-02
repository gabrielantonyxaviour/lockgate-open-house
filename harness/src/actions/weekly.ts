import { type Address } from "viem";
import { read, type Ctx } from "../chain.js";
import { feeFromBps, modelFeeBps } from "../model.js";
import { formatUsdg, parseUsdg } from "../units.js";
import {
  SHARE, expect, navOf, shareBalance,
} from "./common.js";
import {
  buyShares, depositCapital, depositCash, exitNow, markLate, pauseLine, postReserve, processWindow, quote,
  registerPlatform, requestRedeem, requestView, setGated,
} from "./stage1.js";

const WEEKLY = "WeeklyQueuePlatform";
const HUNDRED = 100n * SHARE;
const THOUSAND = 1000n * SHARE;
const FIVE = 5000n * SHARE;
const CAPITAL = parseUsdg("100000");
const RESERVE = parseUsdg("2000");

type Row = { id: bigint; shares: bigint; navValue: bigint; status: number; advanceId: bigint };

/** Stage 1. A finished chain returns the late advance without a transaction. A short cash balance is not deposited twice. */
export async function resumeStage1(ctx: Ctx): Promise<unknown> {
  const done = await finished(ctx);
  if (done) return done;
  await registerPlatform(ctx, { kind: "1", limitUsdg: "25000", reserveBps: "750", initialShares: "1100" });
  await topUp(ctx);
  const count = await read<bigint>(ctx, WEEKLY, "requestCount");
  if (count === 0n) await proveControls(ctx);
  await ensureRedeem(ctx);
  const rows = await loadRows(ctx);
  const queued = must(rows.find((row) => row.shares === HUNDRED || row.status === 2));
  const drawn = await ensureExit(ctx, rows, THOUSAND, "1000");
  await settleSmall(ctx, drawn.advanceId, queued.id);
  await payQueue(ctx, queued.id);
  return lateLeg(ctx);
}

async function finished(ctx: Ctx): Promise<{ lateAdvance: string; shortfall: string } | undefined> {
  if (!ctx.manifest.contracts[WEEKLY]) return undefined;
  const rows = await loadRows(ctx);
  if (!rows.some((row) => row.status === 2)) return undefined;
  const platform = ctx.binding(WEEKLY).address;
  const late = (await loadAdvances(ctx, platform)).find((row) => row.status === 2);
  if (!late) return undefined;
  const reserve = await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [platform]);
  if (reserve !== 0n) return undefined;
  const five = rows.find((row) => row.shares === FIVE);
  const id = five && five.advanceId !== 0n ? five.advanceId : late.id;
  const remaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [id]);
  return { lateAdvance: id.toString(), shortfall: remaining.toString() };
}

async function topUp(ctx: Ctx): Promise<void> {
  const capital = await read<bigint>(ctx, "LockgateCreditLine", "capital");
  if (capital < CAPITAL) await depositCapital(ctx, { amountUsdg: formatUsdg(CAPITAL - capital) });
  const platform = ctx.binding(WEEKLY).address;
  const reserve = await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [platform]);
  const late = (await loadAdvances(ctx, platform)).some((row) => row.status === 2);
  if (!late && reserve < RESERVE) await postReserve(ctx, { amountUsdg: formatUsdg(RESERVE - reserve) });
}

async function proveControls(ctx: Ctx): Promise<void> {
  const block = await ctx.publicClient.getBlock();
  const next = await read<bigint>(ctx, WEEKLY, "nextWindow");
  const priced = await quote(ctx, { navUsdg: "1000" });
  const bps = modelFeeBps(next - block.timestamp);
  expect(priced.available, "quote unavailable", priced.reason);
  expect(priced.feeBps === bps, "fee bps diverged from the stage-1 curve", { priced, bps });
  expect(priced.fee === feeFromBps(parseUsdg("1000"), bps), "fee rounding diverged", priced);
  await setGated(ctx, { gated: "true" });
  const gated = await quote(ctx, { navUsdg: "1000" });
  expect(!gated.available && gated.reason === "gated", "gate did not block the quote", gated);
  await setGated(ctx, { gated: "false" });
  if (!(await read<boolean>(ctx, "LockgateCreditLine", "paused"))) await pauseLine(ctx, { paused: "true" });
  const paused = await quote(ctx, { navUsdg: "1000" });
  expect(!paused.available && paused.reason === "paused", "pause did not block the quote", paused);
  if (await read<boolean>(ctx, "LockgateCreditLine", "paused")) await pauseLine(ctx, { paused: "false" });
}

async function ensureRedeem(ctx: Ctx): Promise<void> {
  const rows = await loadRows(ctx);
  if (rows.some((row) => row.shares === HUNDRED || row.status === 2)) return;
  await requestRedeem(ctx, { shares: "100" });
}

async function ensureExit(ctx: Ctx, rows: Row[], shares: bigint, label: string): Promise<Row> {
  const found = rows.find((row) => row.shares === shares || (row.shares === 0n && row.navValue === navOf(shares)));
  if (found) return found;
  const drawn = await exitNow(ctx, { shares: label }) as { advanceId: string; nav: string; received: string };
  const advance = await read<{ principal: bigint; fee: bigint }>(ctx, "LockgateCreditLine", "getAdvance", [BigInt(drawn.advanceId)]);
  expect(BigInt(advance.principal) + BigInt(advance.fee) === BigInt(drawn.nav), "advance does not add up to nav", advance);
  expect(BigInt(drawn.received) === BigInt(advance.principal), "investor did not receive the principal", drawn);
  const again = (await loadRows(ctx)).find((row) => row.advanceId === BigInt(drawn.advanceId));
  return must(again);
}

/**
 * A failed repay leaves cash at remaining-1 and does not roll the window, so that balance
 * is indistinguishable from a deposit that has not been processed. Process it. Never deposit it twice.
 */
async function settleSmall(ctx: Ctx, advanceId: bigint, queueId: bigint): Promise<void> {
  let remaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
  if (remaining === 0n) return;
  const short = remaining - 1n;
  let cash = await read<bigint>(ctx, WEEKLY, "cash");
  if (short > 0n && cash < short) {
    await depositCash(ctx, { amountUsdg: formatUsdg(short - cash) });
    cash = short;
  }
  if (short > 0n && cash === short) {
    const next = await read<bigint>(ctx, WEEKLY, "nextWindow");
    const held = await processWindow(ctx, {});
    const stillDue = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
    const queuedView = await requestView(ctx, WEEKLY, queueId);
    expect(stillDue === remaining, "a short cash deposit repaid the advance", { stillDue, advanceRemaining: remaining });
    expect(queuedView.status === 0, "queue was paid before the advance", queuedView);
    expect((held as { nextWindow: string }).nextWindow === next.toString(), "window rolled on a failed repay");
    await depositCash(ctx, { amountUsdg: formatUsdg(1n) });
  }
  remaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
  if (remaining === 0n) return;
  cash = await read<bigint>(ctx, WEEKLY, "cash");
  if (cash < remaining) await depositCash(ctx, { amountUsdg: formatUsdg(remaining - cash) });
  await processWindow(ctx, {});
  const repaid = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [advanceId]);
  const afterRepay = await requestView(ctx, WEEKLY, queueId);
  expect(repaid === 0n, "advance was not repaid", repaid.toString());
  expect(afterRepay.status === 0, "queue was paid with the repayment cash", afterRepay);
}

async function payQueue(ctx: Ctx, queueId: bigint): Promise<void> {
  const queued = await requestView(ctx, WEEKLY, queueId);
  if (queued.status === 2) return;
  const cash = await read<bigint>(ctx, WEEKLY, "cash");
  const gap = queued.navValue > cash ? queued.navValue - cash : 0n;
  if (gap > 0n) await depositCash(ctx, { amountUsdg: formatUsdg(gap) });
  await processWindow(ctx, {});
  const paid = await requestView(ctx, WEEKLY, queueId);
  expect(paid.status === 2, "queued exit was not paid", paid);
}

async function lateLeg(ctx: Ctx): Promise<{ lateAdvance: string; shortfall: string }> {
  const rows = await loadRows(ctx);
  let five = rows.find((row) => row.shares === FIVE);
  if (!five && await shareBalance(ctx, WEEKLY) < FIVE) await buyShares(ctx, { shares: "5000" });
  if (!five) five = await ensureExit(ctx, await loadRows(ctx), FIVE, "5000");
  const advance = await read(ctx, "LockgateCreditLine", "getAdvance", [five.advanceId]);
  const status = field(advance, "status", 6);
  const late = status === 2
    ? { status, remaining: (await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [five.advanceId])).toString() }
    : await markLate(ctx, { advanceId: five.advanceId.toString() }) as { status: number; remaining: string };
  const reserve = await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [ctx.binding(WEEKLY).address]);
  expect(late.status === 2, "advance was not marked late", late);
  expect(BigInt(late.remaining) === navOf(FIVE) - RESERVE, "slash did not consume the posted reserve", late);
  expect(reserve === 0n, "reserve was not fully slashed", reserve.toString());
  return { lateAdvance: five.advanceId.toString(), shortfall: late.remaining };
}

async function loadRows(ctx: Ctx): Promise<Row[]> {
  const count = await read<bigint>(ctx, WEEKLY, "requestCount");
  const rows: Row[] = [];
  for (let id = 1n; id <= count; id++) rows.push(asRow(id, await read(ctx, WEEKLY, "getRequest", [id])));
  return rows;
}

async function loadAdvances(ctx: Ctx, source: Address): Promise<Array<{ id: bigint; status: number }>> {
  const ids = await read<readonly bigint[]>(ctx, "LockgateCreditLine", "advancesOf", [source]);
  const rows = [];
  for (const id of ids) {
    rows.push({ id, status: field(await read(ctx, "LockgateCreditLine", "getAdvance", [id]), "status", 6) });
  }
  return rows;
}

function asRow(id: bigint, value: unknown): Row {
  const row = value as { shares?: bigint; navValue?: bigint; status?: number; advanceId?: bigint };
  if (row && typeof row === "object" && "navValue" in row) {
    return {
      id, shares: BigInt(row.shares ?? 0), navValue: BigInt(row.navValue ?? 0),
      status: Number(row.status), advanceId: BigInt(row.advanceId ?? 0),
    };
  }
  const parts = Array.isArray(value) ? value : [];
  return {
    id, shares: BigInt(parts[1] ?? 0), navValue: BigInt(parts[2] ?? 0),
    status: Number(parts[4]), advanceId: BigInt(parts[5] ?? 0),
  };
}

function field(value: unknown, key: string, index: number): number {
  if (value && typeof value === "object" && key in value) return Number((value as Record<string, unknown>)[key]);
  const parts = Array.isArray(value) ? value : [];
  return Number(parts[index]);
}

function must(row: Row | undefined): Row {
  expect(row !== undefined, "stage 1 request is missing");
  return row as Row;
}
