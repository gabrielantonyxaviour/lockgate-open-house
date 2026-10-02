import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_TIME_SCALE, MIN_FEE_BPS } from "../src/params.js";
import { feeFromBps, quoteFee, type Quote } from "../src/pricing.js";

const flat = {
  navAgeSeconds: 0,
  gated: false,
  exposureBps: 0,
  utilizationBps: 0,
  riskBps: 0,
  timeScale: 1,
};

function priced(quote: Quote): { bps: number; rawBps: number } {
  if (!quote.available) assert.fail("quote refused");
  return quote;
}

test("thirty idle days at 12% APR is 99 bps, the on-chain half-up of 98.63", () => {
  const quote = priced(quoteFee({ ...flat, secondsToWindow: 30 * 86_400 }));
  const sixty = priced(quoteFee({ ...flat, secondsToWindow: 60 * 86_400 }));
  assert.equal(quote.bps, 99);
  assert.equal(quote.rawBps, 99);
  assert.equal(sixty.rawBps, 197);
  assert.equal(sixty.bps, 197);
});

test("demo time scale prices a 10 minute wait like 30 days", () => {
  const quote = priced(quoteFee({ ...flat, secondsToWindow: 600, timeScale: DEMO_TIME_SCALE }));
  const unscaled = priced(quoteFee({ ...flat, secondsToWindow: 600 }));
  assert.equal(quote.bps, 99);
  assert.equal(unscaled.bps, MIN_FEE_BPS);
  assert.ok(unscaled.rawBps < MIN_FEE_BPS);
});

test("fee is floored, and refused when above the max, gated or stale", () => {
  const tiny = quoteFee({ ...flat, secondsToWindow: 1 });
  const hot = quoteFee({ ...flat, secondsToWindow: 366 * 86_400 - 1, utilizationBps: 10_000 });
  const gated = quoteFee({ ...flat, secondsToWindow: 86_400, gated: true });
  const stale = quoteFee({ ...flat, secondsToWindow: 86_400, navAgeSeconds: 8 * 86_400 });
  assert.equal(tiny.available && tiny.bps, MIN_FEE_BPS);
  assert.deepEqual(hot, { available: false, bps: 0, reason: "fee-above-max" });
  assert.deepEqual(gated, { available: false, bps: 0, reason: "gated" });
  assert.deepEqual(stale, { available: false, bps: 0, reason: "stale-nav" });
});

test("platform risk adds up to 600 APR bps", () => {
  const high = quoteFee({ ...flat, secondsToWindow: 30 * 86_400, riskBps: 5_000 });
  const max = quoteFee({ ...flat, secondsToWindow: 30 * 86_400, riskBps: 10_000 });
  assert.equal(high.available && high.bps, 123);
  assert.equal(max.available && max.bps, 148);
});

test("utilization is flat to the kink, then rises; fee rounds up", () => {
  assert.equal(feeFromBps(10_000, 25), 25);
  assert.equal(feeFromBps(1, 25), 1);
  assert.equal(feeFromBps(1_000_001, 99), 9_901);
  const kink = priced(quoteFee({ ...flat, secondsToWindow: 30 * 86_400, utilizationBps: 6_667 }));
  const busy = priced(quoteFee({ ...flat, secondsToWindow: 30 * 86_400, utilizationBps: 9_000 }));
  assert.equal(kink.bps, 99);
  assert.equal(busy.bps, 133);
  assert.ok(feeFromBps(10_000_000, busy.bps) < 10_000_000);
});
