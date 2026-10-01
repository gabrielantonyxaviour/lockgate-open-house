import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_TIME_SCALE, MAX_FEE_BPS, MIN_FEE_BPS, YEAR_SECONDS } from "../src/params.js";
import { feeFromBps, quoteFee } from "../src/pricing.js";

const flat = {
  navAgeSeconds: 0,
  gated: false,
  exposureBps: 0,
  utilizationBps: 0,
  riskBps: 10_000,
  timeScale: 1,
};

test("thirty idle days at 12% APR is 98 bps, about 1% per month", () => {
  const quote = quoteFee({ ...flat, secondsToWindow: 30 * 86_400 });
  assert.equal(quote.available, true);
  if (!quote.available) return;
  assert.equal(quote.bps, 98);
  assert.equal(Math.floor((1200 * 30 * 86_400) / YEAR_SECONDS), 98);
});

test("demo time scale prices a 10 minute wait like 30 days", () => {
  const quote = quoteFee({ ...flat, secondsToWindow: 600, timeScale: DEMO_TIME_SCALE });
  assert.equal(quote.available, true);
  if (!quote.available) return;
  assert.equal(quote.bps, 98);
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

test("fee rounds up and cannot consume the whole advance", () => {
  assert.equal(feeFromBps(10_000, 25), 25);
  assert.equal(feeFromBps(1, 25), 1);
  const quote = quoteFee({ ...flat, secondsToWindow: 30 * 86_400, utilizationBps: 5_000 });
  assert.equal(quote.available, true);
  if (!quote.available) return;
  assert.ok(quote.bps >= MIN_FEE_BPS && quote.bps <= MAX_FEE_BPS);
});
