import type { PricingParams, QuoteInput } from "../domain.js";
import { RISK_WEIGHTS } from "../pricing/defaults.js";
import { mulDivRoundHalfUp } from "../money.js";

export type RiskBreakdown = {
  bps: number;
  repayment: number;
  queue: number;
  gating: number;
  nav: number;
  concentration: number;
};

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 10_000) return 10_000;
  return value;
}

export function repaymentScore(input: QuoteInput, params: PricingParams): number {
  if (input.repayment.samples < params.minSamples) return params.unknownHistoryBps;
  const late = input.repayment.late + input.repayment.slashed;
  const lateBps = Math.floor((late * 7_000) / input.repayment.samples);
  const slashBps = Math.floor((input.repayment.slashed * 10_000) / input.repayment.samples);
  return clamp(lateBps + slashBps);
}

export function queueScore(input: QuoteInput, rollovers: number): number {
  if (!input.cashKnown) return 8_000;
  const queued = input.queuedAhead + input.navValue;
  const roll = Math.min(10_000, Math.max(0, rollovers) * 2_000);
  if (queued === 0n) return roll;
  if (input.cashAvailable === 0n) return 10_000;
  const depth = Number((queued * 10_000n) / (queued + input.cashAvailable));
  return clamp(Math.max(depth, roll));
}

export function gateScore(input: QuoteInput, params: PricingParams): number {
  if (input.gated) return 10_000;
  if (input.repayment.windowsObserved === 0) return params.unknownGateBps;
  return clamp(Math.floor((input.repayment.gateEvents * 10_000) / input.repayment.windowsObserved));
}

export function navScore(ageSeconds: number, params: PricingParams): number {
  if (ageSeconds <= 0) return 0;
  if (ageSeconds >= params.maxNavAgeSeconds) return 10_000;
  return clamp(Math.floor((ageSeconds * 10_000) / params.maxNavAgeSeconds));
}

export function concentrationScore(exposureBps: number, capBps: number): number {
  if (capBps <= 0) return 10_000;
  return clamp(Math.floor((exposureBps * 10_000) / capBps));
}

export function scoreRisk(
  input: QuoteInput,
  params: PricingParams,
  rollovers: number,
  exposureBps: number,
  navAgeSeconds: number,
): RiskBreakdown {
  const parts = {
    repayment: repaymentScore(input, params),
    queue: input.cashKnown ? queueScore(input, rollovers) : params.unknownLiquidityQueueBps,
    gating: gateScore(input, params),
    nav: navScore(navAgeSeconds, params),
    concentration: concentrationScore(exposureBps, params.concentrationCapBps),
  };
  const weighted =
    parts.repayment * RISK_WEIGHTS.repayment +
    parts.queue * RISK_WEIGHTS.queue +
    parts.gating * RISK_WEIGHTS.gating +
    parts.nav * RISK_WEIGHTS.nav +
    parts.concentration * RISK_WEIGHTS.concentration;
  const bps = Number(mulDivRoundHalfUp(BigInt(weighted), 1n, 10_000n));
  return { bps: clamp(bps), ...parts };
}
