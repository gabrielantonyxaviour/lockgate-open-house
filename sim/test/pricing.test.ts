import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_APR_BPS, DEMO_TIME_SCALE, MAX_FEE_BPS, MIN_FEE_BPS, UTIL_PREMIUM_AT_FULL_BPS, YEAR_SECONDS } from "../src/params.js";
import { feeFromBps, quoteFee, type Quote } from "../src/pricing.js";

const flat = {
  navAgeSeconds: 0,
  gated: false,
  exposureBps: 0,
  utilizationBps: 0,
  riskBps: 10_000,
  timeScale: 1,
};

function priced(quote: Quote): { bps: number; rawBps: number } {
  if (!quote.available) assert.fail("quote refused");
  return quote;
}

test("thirty idle days at 12% APR is 98 bps, about 1% per month", () => {
  const quote = priced(quoteFee({ ...flat, secondsToWindow: 30 * 86_400 }));
  const sixty = priced(quoteFee({ ...flat, secondsToWindow: 60 * 86_400 }));
  assert.equal(quote.rawBps, Math.floor((BASE_APR_BPS * 30 * 86_400) / YEAR_SECONDS));
  assert.equal(quote.bps, 98);
  assert.equal(quote.rawBps, 98);
  assert.equal(sixty.rawBps, 197);
  assert.equal(sixty.bps, 197);
  assert.notEqual(sixty.bps, quote.bps);
});

test("demo time scale prices a 10 minute wait like 30 days", () => {
  const quote = priced(quoteFee({ ...flat, secondsToWindow: 600, timeScale: DEMO_TIME_SCALE }));
  const unscaled = priced(quoteFee({ ...flat, secondsToWindow: 600 }));
  assert.equal(quote.bps, 98);
  assert.equal(quote.rawBps, 98);
  assert.equal(unscaled.bps, MIN_FEE_BPS);
  assert.ok(unscaled.rawBps < MIN_FEE_BPS);
});

test("fee is clamped and refused when gated or stale", () => {
  const tiny = quoteFee({ ...flat, secondsToWindow: 1 });
  const hot = quoteFee({ ...flat, secondsToWindow: 366 * 86_400 - 1, utilizationBps: 10_000 });
  const gated = quoteFee({ ...flat, secondsToWindow: 86_400, gated: true });
  const stale = quoteFee({ ...flat, secondsToWindow: 86_400, navAgeSeconds: 8 * 86_400 });
  assert.equal(tiny.available && tiny.bps, MIN_FEE_BPS);
  assert.equal(hot.available && hot.bps, MAX_FEE_BPS);
  assert.deepEqual(gated, { available: false, bps: 0, reason: "gated" });
  assert.deepEqual(stale, { available: false, bps: 0, reason: "stale-nav" });
});

test("platform risk scales only the APR component, before the clamp", () => {
  const high = quoteFee({ ...flat, secondsToWindow: 30 * 86_400, riskBps: 13_000 });
  const low = quoteFee({ ...flat, secondsToWindow: 30 * 86_400, riskBps: 8_000 });
  assert.equal(high.available && high.bps, 127);
  assert.equal(low.available && low.bps, 78);
});

test("fee rounds up, and a normal advance keeps a remainder", () => {
  assert.equal(feeFromBps(10_000, 25), 25);
  assert.ok(feeFromBps(10_000, 25) < 10_000);
  assert.equal(feeFromBps(1, 25), 1);
  const quote = priced(quoteFee({ ...flat, secondsToWindow: 30 * 86_400, utilizationBps: 5_000 }));
  const util = Math.floor((5_000 * UTIL_PREMIUM_AT_FULL_BPS) / 10_000);
  assert.equal(util, 250);
  assert.equal(quote.rawBps, 98 + util);
  assert.equal(quote.bps, 348);
  assert.ok(feeFromBps(10_000_000, quote.bps) < 10_000_000);
});
