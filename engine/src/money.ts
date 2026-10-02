import { EngineError } from "./errors.js";

/** ACT/365. 365 * 86400. Specified in MODEL.md; SPEC.md does not name a day count. */
export const SECONDS_PER_YEAR = 31_536_000n;

export const USDC_SCALE = 1_000_000n;
export const MIN_NAV = USDC_SCALE;
export const MAX_NAV = 1_000_000_000_000n * USDC_SCALE;

/** Half away from zero for positive integers. Denominator must be positive. */
export function mulDivRoundHalfUp(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new EngineError("invariant", "denominator");
  if (amount < 0n || numerator < 0n) throw new EngineError("invariant", "negative money");
  return (amount * numerator + denominator / 2n) / denominator;
}

export function mulDivCeil(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new EngineError("invariant", "denominator");
  if (amount < 0n || numerator < 0n) throw new EngineError("invariant", "negative money");
  if (amount === 0n || numerator === 0n) return 0n;
  return (amount * numerator + denominator - 1n) / denominator;
}

export function ceilDiv(amount: bigint, denominator: bigint): bigint {
  return mulDivCeil(amount, 1n, denominator);
}

export function lerpBps(start: number, end: number, numerator: number, denominator: number): number {
  if (denominator <= 0) throw new EngineError("invariant", "span");
  if (numerator <= 0) return start;
  if (numerator >= denominator) return end;
  const delta = BigInt(end - start);
  const stepped = mulDivRoundHalfUp(delta < 0n ? -delta : delta, BigInt(numerator), BigInt(denominator));
  const next = delta < 0n ? BigInt(start) - stepped : BigInt(start) + stepped;
  return Number(next);
}

/**
 * Scale a token amount into 6-decimal USDG units.
 * Cash and collateral use floor. A queue in front of an exit uses ceil.
 */
export function toUsdg6(amount: bigint, decimals: number, rounding: "floor" | "ceil" = "floor"): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new EngineError("invariant", "decimals");
  }
  if (amount < 0n) throw new EngineError("invariant", "negative money");
  if (decimals === 6) return amount;
  if (decimals > 6) {
    const scale = 10n ** BigInt(decimals - 6);
    return rounding === "ceil" ? mulDivCeil(amount, 1n, scale) : amount / scale;
  }
  return amount * 10n ** BigInt(6 - decimals);
}
