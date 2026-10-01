import type { PricingParams, QuoteInput, RepaymentHistory } from "../domain.js";
import { quoteExit, type Quote } from "../quote.js";

export type TickOutcome = "repay" | "late" | "slash" | "refuse";

export type BacktestTick = {
  input: QuoteInput;
  outcome: TickOutcome;
};

export type TickResult = {
  platformId: string;
  outcome: TickOutcome;
  quote: Quote;
  feeEarned: bigint;
  loss: bigint;
  reserveUsed: bigint;
  matchedExpectation: boolean;
};

export type BacktestReport = {
  ticks: TickResult[];
  feeEarned: bigint;
  loss: bigint;
  reserveUsed: bigint;
  advanced: number;
  refused: number;
  mismatches: number;
};

export function applyHistory(history: RepaymentHistory, outcome: TickOutcome): RepaymentHistory {
  if (outcome === "refuse") return history;
  const next = { ...history, samples: history.samples + 1, windowsObserved: history.windowsObserved + 1 };
  if (outcome === "repay") next.onTime += 1;
  if (outcome === "late") next.late += 1;
  if (outcome === "slash") next.slashed += 1;
  return next;
}

export function runBacktest(ticks: BacktestTick[], params: PricingParams): BacktestReport {
  const results: TickResult[] = [];
  let feeEarned = 0n;
  let loss = 0n;
  let reserveUsed = 0n;
  let advanced = 0;
  let refused = 0;
  let mismatches = 0;
  const historyByPlatform = new Map<string, RepaymentHistory>();
  for (const tick of ticks) {
    const history = historyByPlatform.get(tick.input.platformId) ?? tick.input.repayment;
    const input = { ...tick.input, repayment: history };
    const quote = quoteExit(input, params);
    let tickFee = 0n;
    let tickLoss = 0n;
    let tickReserve = 0n;
    const expectRefuse = tick.outcome === "refuse";
    const matched = quote.available !== expectRefuse;
    if (!matched) mismatches += 1;
    if (!quote.available) {
      refused += 1;
    } else if (tick.outcome === "repay") {
      advanced += 1;
      tickFee = quote.fee;
      feeEarned += quote.fee;
    } else if (tick.outcome === "late") {
      advanced += 1;
    } else if (tick.outcome === "slash") {
      advanced += 1;
      const recovered = input.reserveBalance < quote.navValue ? input.reserveBalance : quote.navValue;
      tickReserve = recovered;
      tickLoss = quote.payout > recovered ? quote.payout - recovered : 0n;
      reserveUsed += tickReserve;
      loss += tickLoss;
    }
    historyByPlatform.set(input.platformId, applyHistory(history, tick.outcome));
    results.push({
      platformId: input.platformId,
      outcome: tick.outcome,
      quote,
      feeEarned: tickFee,
      loss: tickLoss,
      reserveUsed: tickReserve,
      matchedExpectation: matched,
    });
  }
  return { ticks: results, feeEarned, loss, reserveUsed, advanced, refused, mismatches };
}
