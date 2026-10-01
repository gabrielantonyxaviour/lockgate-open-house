import {
  AGE_PREMIUM_AT_MAX_BPS,
  BASE_APR_BPS,
  CONC_PREMIUM_AT_FULL_BPS,
  MAX_FEE_BPS,
  MAX_NAV_AGE_SECONDS,
  MIN_FEE_BPS,
  UTIL_PREMIUM_AT_FULL_BPS,
  YEAR_SECONDS,
} from "./params.js";

export type QuoteInput = {
  secondsToWindow: number;
  navAgeSeconds: number;
  gated: boolean;
  exposureBps: number;
  utilizationBps: number;
  /** 10_000 = 1.0x on the APR component. Assumption scalar. PRODUCT.md: price includes platform risk. */
  riskBps: number;
  timeScale: number;
  maxNavAgeSeconds?: number;
};

export type Quote =
  | { available: true; bps: number; rawBps: number }
  | { available: false; bps: 0; reason: string };

/**
 * Integer curve shared with contracts/test/invariant/src/ReferencePricing.sol.
 * APR component is baseApr * time / year * risk, then utilization, concentration
 * and NAV-age add-ons. Result is clamped to [minFeeBps, maxFeeBps].
 * Gated or stale NAV is unavailable (no clamp into a fake price).
 */
export function quoteFee(input: QuoteInput): Quote {
  if (input.gated) return { available: false, bps: 0, reason: "gated" };
  const maxAge = input.maxNavAgeSeconds ?? MAX_NAV_AGE_SECONDS;
  if (input.navAgeSeconds > maxAge) return { available: false, bps: 0, reason: "stale-nav" };
  if (input.exposureBps > 10_000 || input.utilizationBps > 10_000) {
    return { available: false, bps: 0, reason: "bps-range" };
  }
  if (input.secondsToWindow > 366 * 24 * 60 * 60 || input.timeScale > 10_000) {
    return { available: false, bps: 0, reason: "tenor" };
  }
  if (input.riskBps > 50_000) return { available: false, bps: 0, reason: "risk" };
  const scaled = input.secondsToWindow * input.timeScale;
  let apr = Math.floor((BASE_APR_BPS * scaled) / YEAR_SECONDS);
  apr = Math.floor((apr * input.riskBps) / 10_000);
  const utilPrem = Math.floor((input.utilizationBps * UTIL_PREMIUM_AT_FULL_BPS) / 10_000);
  const concPrem = Math.floor((input.exposureBps * CONC_PREMIUM_AT_FULL_BPS) / 10_000);
  const agePrem = maxAge === 0 ? 0 : Math.floor((input.navAgeSeconds * AGE_PREMIUM_AT_MAX_BPS) / maxAge);
  const raw = apr + utilPrem + concPrem + agePrem;
  const bps = Math.min(MAX_FEE_BPS, Math.max(MIN_FEE_BPS, raw));
  return { available: true, bps, rawBps: raw };
}

/** Ceiling division. Fee is never above nav; caller must reject fee >= nav. */
export function feeFromBps(navValue: number, bps: number): number {
  if (navValue <= 0 || bps <= 0) return 0;
  return Math.floor((navValue * bps + 9_999) / 10_000);
}
