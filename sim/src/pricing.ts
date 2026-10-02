import { MAX_NAV_AGE_SECONDS, PRICING } from "./params.js";

export type QuoteInput = {
  secondsToWindow: number;
  navAgeSeconds: number;
  gated: boolean;
  exposureBps: number;
  utilizationBps: number;
  /** Platform risk score, 0..10_000, the value `LockgateCreditLine.riskOf` passes to `PricingEngine.feeCode`. */
  riskBps: number;
  timeScale: number;
  maxNavAgeSeconds?: number;
};

export type Quote =
  | { available: true; bps: number; rawBps: number }
  | { available: false; bps: 0; reason: string };

const BPS = 10_000n;

/** PricingMath.halfUp: floor(x*y/den), +1 when the remainder is above half, or exactly half on an even den. */
function halfUp(x: bigint, y: bigint, den: bigint): bigint {
  const product = x * y;
  const floor = product / den;
  const rem = product % den;
  if (rem === 0n) return floor;
  const mid = den / 2n;
  return rem > mid || (den % 2n === 0n && rem === mid) ? floor + 1n : floor;
}

/** PricingMath.lerp. */
function lerp(start: bigint, end: bigint, num: bigint, den: bigint): bigint {
  if (num === 0n || den === 0n) return start;
  if (num >= den) return end;
  return start + halfUp(end - start, num, den);
}

function utilizationApr(utilizationBps: number): bigint {
  const util = BigInt(Math.min(utilizationBps, 10_000));
  const kink = BigInt(PRICING.kinkUtilBps);
  if (util <= kink) return lerp(BigInt(PRICING.baseAprBps), BigInt(PRICING.aprAtKinkBps), util, kink);
  return lerp(BigInt(PRICING.aprAtKinkBps), BigInt(PRICING.aprAtFullBps), util - kink, BPS - kink);
}

/**
 * Exact port of contracts/src/core/PricingMath.sol `quoteCode` under the `PricingEngine` constructor params:
 * utilization APR (kinked), plus risk, NAV-age and concentration APR, all scaled by
 * `halfUp(apr * seconds, timeScale, year)`. Raised to the min fee; a raw fee above the max is refused, not clamped.
 */
export function quoteFee(input: QuoteInput): Quote {
  if (input.gated) return { available: false, bps: 0, reason: "gated" };
  const maxAge = input.maxNavAgeSeconds ?? MAX_NAV_AGE_SECONDS;
  if (input.navAgeSeconds > maxAge) return { available: false, bps: 0, reason: "stale-nav" };
  if (input.exposureBps > 10_000 || input.utilizationBps > 10_000) {
    return { available: false, bps: 0, reason: "bps-range" };
  }
  if (input.secondsToWindow > PRICING.maxTenorSeconds || input.timeScale > 10_000) {
    return { available: false, bps: 0, reason: "tenor" };
  }
  if (input.riskBps < 0 || input.riskBps > 10_000) return { available: false, bps: 0, reason: "risk" };
  let apr = utilizationApr(input.utilizationBps);
  if (input.riskBps > 0) apr += halfUp(BigInt(input.riskBps), BigInt(PRICING.maxRiskPremiumAprBps), BPS);
  const warn = PRICING.navWarnSeconds;
  if (input.navAgeSeconds > warn && maxAge > warn && PRICING.navAgeMaxPremiumAprBps > 0) {
    apr += halfUp(BigInt(PRICING.navAgeMaxPremiumAprBps), BigInt(input.navAgeSeconds - warn), BigInt(maxAge - warn));
  }
  if (PRICING.concentrationMaxPremiumAprBps > 0 && input.exposureBps > 0) {
    const exposure = BigInt(Math.min(input.exposureBps, PRICING.concentrationCapBps));
    apr += halfUp(exposure, BigInt(PRICING.concentrationMaxPremiumAprBps), BigInt(PRICING.concentrationCapBps));
  }
  const raw = input.secondsToWindow === 0 || input.timeScale === 0
    ? 0
    : Number(halfUp(apr * BigInt(input.secondsToWindow), BigInt(input.timeScale), BigInt(PRICING.yearSeconds)));
  if (raw > PRICING.maxFeeBps) return { available: false, bps: 0, reason: "fee-above-max" };
  return { available: true, bps: Math.max(PRICING.minFeeBps, raw), rawBps: raw };
}

/** PricingMath.feeFromBps: ceiling division. Caller must reject fee >= nav. */
export function feeFromBps(navValue: number, bps: number): number {
  if (navValue <= 0 || bps <= 0) return 0;
  return Number((BigInt(navValue) * BigInt(bps) + 9_999n) / 10_000n);
}
