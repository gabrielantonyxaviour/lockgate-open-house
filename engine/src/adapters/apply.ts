import type { QuoteInput } from "../domain.js";
import { QUEUE } from "../pricing/defaults.js";
import type { KasuRead } from "./kasu/read.js";
import type { MapleRead } from "./maple/read.js";
import type { UsdaiRead } from "./usdai/read.js";

function unpriced(queued: bigint | null, truncated: boolean): boolean {
  return queued === null || truncated;
}

/** Copy the Kasu clock. Unknown cash unless every tranche's pool token reported 6 decimals. */
export function applyKasuRead(input: QuoteInput, read: KasuRead): QuoteInput {
  const unitOk = read.poolDecimals === 6;
  const blocked = !unitOk || unpriced(read.queuedValue, read.truncated);
  return {
    ...input,
    kind: "weekly-cycle",
    epochStart: read.epochStart,
    epochSeconds: read.epochSeconds,
    clearingSeconds: read.clearingSeconds,
    queuedAhead: unitOk ? (read.queuedValue ?? 0n) : 0n,
    cashKnown: blocked ? false : input.cashKnown,
    truncated: read.truncated || input.truncated === true,
  };
}

/** Maple's queue view is not committed cash, so the quote uses the unknown-cash wait. */
export function applyMapleRead(input: QuoteInput, read: MapleRead): QuoteInput {
  return {
    ...input,
    kind: "fifo-open",
    queuedAhead: read.queuedValue ?? 0n,
    cashKnown: false,
    truncated: unpriced(read.queuedValue, read.truncated),
  };
}

/** Use the rolled sUSDai window, redemption cash, and NAV. Cash per epoch is that balance, including zero. */
export function applyUsdaiRead(input: QuoteInput, read: UsdaiRead): QuoteInput {
  return {
    ...input,
    kind: "epoch",
    epochStart: read.nextWindowAt - read.epochSeconds,
    epochSeconds: read.epochSeconds,
    cutoffSeconds: QUEUE.epochCutoffSeconds,
    queuedAhead: read.queuedValue,
    cashAvailable: read.cashAvailable,
    cashPerEpoch: read.cashAvailable,
    cashKnown: true,
    navValue: read.nav,
    navUpdatedAt: input.now,
  };
}
