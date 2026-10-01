import { EngineError } from "../errors.js";
import { ceilDiv } from "../money.js";
import { QUEUE } from "../pricing/defaults.js";
import type { QuoteInput } from "../domain.js";

export type WaitResult = {
  secondsToClear: number;
  dueAt: number;
  rollovers: number;
  windowOpen: boolean;
  illiquid: boolean;
  assumption?: string;
};

function finiteWait(now: number, dueAt: number, rollovers: number, assumption?: string): WaitResult {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(dueAt)) {
    throw new EngineError("param", "queue clock does not fit a safe integer");
  }
  return {
    secondsToClear: Math.max(0, dueAt - now),
    dueAt,
    rollovers,
    windowOpen: dueAt <= now,
    illiquid: false,
    assumption,
  };
}

export function rollForward(firstWindowAt: number, windowSeconds: number, now: number): number {
  if (windowSeconds <= 0) throw new EngineError("param", "window length must be positive");
  if (now < firstWindowAt) return firstWindowAt;
  const behind = now - firstWindowAt;
  const steps = Math.ceil(behind / windowSeconds);
  return firstWindowAt + steps * windowSeconds;
}

export function withLiquidity(
  input: QuoteInput,
  firstWindowAt: number,
  windowSeconds: number,
): WaitResult {
  const windowAt = rollForward(firstWindowAt, windowSeconds, input.now);
  if (windowAt <= input.now) {
    return finiteWait(input.now, windowAt, 0);
  }
  // Kasu and epoch docs do not state a maximum rollover. Unknown cash is a refusal.
  if (!input.cashKnown) {
    return {
      secondsToClear: Math.max(0, windowAt - input.now),
      dueAt: windowAt,
      rollovers: 0,
      windowOpen: false,
      illiquid: true,
      assumption: "liquidity-unknown",
    };
  }
  const need = input.queuedAhead + input.navValue;
  if (input.cashAvailable >= need) return finiteWait(input.now, windowAt, 0);
  if (input.cashPerEpoch <= 0n) {
    return { secondsToClear: 0, dueAt: windowAt, rollovers: 0, windowOpen: false, illiquid: true };
  }
  const rollovers = ceilDiv(need - input.cashAvailable, input.cashPerEpoch);
  if (rollovers > BigInt(QUEUE.maxRollovers)) {
    return { secondsToClear: 0, dueAt: windowAt, rollovers: Number(QUEUE.maxRollovers), windowOpen: false, illiquid: true };
  }
  const dueAt = windowAt + Number(rollovers) * windowSeconds;
  return finiteWait(input.now, dueAt, Number(rollovers));
}

function epochContaining(epochStart: number, epochSeconds: number, at: number): number {
  if (at < epochStart) return epochStart;
  const steps = Math.floor((at - epochStart) / epochSeconds);
  return epochStart + steps * epochSeconds;
}

export function weeklyWait(input: QuoteInput): WaitResult {
  const epochSeconds = input.epochSeconds ?? QUEUE.kasuEpochSeconds;
  const clearingSeconds = input.clearingSeconds ?? QUEUE.kasuClearingSeconds;
  if (input.epochStart === undefined) throw new EngineError("param", "weekly-cycle requires epochStart");
  if (clearingSeconds <= 0 || clearingSeconds >= epochSeconds) {
    throw new EngineError("param", "clearing period must sit inside the epoch");
  }
  const requestedAt = input.requestedAt ?? input.now;
  const start = epochContaining(input.epochStart, epochSeconds, requestedAt);
  const end = start + epochSeconds;
  const clearingStart = end - clearingSeconds;
  const firstEnd = requestedAt >= clearingStart ? end + epochSeconds : end;
  return withLiquidity(input, firstEnd, epochSeconds);
}

export function epochWait(input: QuoteInput): WaitResult {
  const epochSeconds = input.epochSeconds ?? QUEUE.epochSeconds;
  const cutoffSeconds = input.cutoffSeconds ?? QUEUE.epochCutoffSeconds;
  if (input.epochStart === undefined) throw new EngineError("param", "epoch requires epochStart");
  if (cutoffSeconds < 0 || cutoffSeconds >= epochSeconds) {
    throw new EngineError("param", "cutoff must sit inside the epoch");
  }
  const requestedAt = input.requestedAt ?? input.now;
  const start = epochContaining(input.epochStart, epochSeconds, requestedAt);
  const end = start + epochSeconds;
  const closesAt = end - cutoffSeconds;
  const firstEnd = requestedAt >= closesAt ? end + epochSeconds : end;
  return withLiquidity(input, firstEnd, epochSeconds);
}

export function quarterlyWait(input: QuoteInput): WaitResult {
  const windowSeconds = input.windowSeconds ?? input.epochSeconds ?? QUEUE.quarterlySeconds;
  if (input.epochStart === undefined) throw new EngineError("param", "quarterly-gated requires epochStart");
  const requestedAt = input.requestedAt ?? input.now;
  const start = epochContaining(input.epochStart, windowSeconds, requestedAt);
  const firstEnd = start + windowSeconds;
  return withLiquidity(input, firstEnd, windowSeconds);
}

export function fifoWait(input: QuoteInput): WaitResult {
  const covered = input.coveredWaitSeconds ?? QUEUE.mapleCoveredWaitSeconds;
  const worst = input.worstCaseSeconds ?? QUEUE.mapleWorstCaseSeconds;
  if (!input.cashKnown) return finiteWait(input.now, input.now + worst, 0, "maple-worst-case-30d");
  const need = input.queuedAhead + input.navValue;
  if (input.cashAvailable >= need) {
    return finiteWait(input.now, input.now + covered, 0, "maple-under-24h");
  }
  return finiteWait(input.now, input.now + worst, 1, "maple-liquidity-short");
}

export function waitFor(input: QuoteInput): WaitResult {
  switch (input.kind) {
    case "weekly-cycle":
      return weeklyWait(input);
    case "epoch":
      return epochWait(input);
    case "quarterly-gated":
      return quarterlyWait(input);
    case "fifo-open":
      return fifoWait(input);
  }
}
