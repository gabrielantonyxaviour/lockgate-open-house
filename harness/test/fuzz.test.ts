import assert from "node:assert/strict";
import { test } from "node:test";
import { HarnessError } from "../src/errors.js";
import { feeFromBps, modelFeeBps } from "../src/model.js";
import { formatUsdg, parseBps, parseUsdg } from "../src/units.js";

const YEAR = 31_536_000n;
const TRIALS = 256;

function next(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}

test("fee rounding stays on the ceiling for 256 draws", () => {
  const draw = next(0x10c0a7e);
  for (let i = 0; i < TRIALS; i++) {
    const nav = BigInt(draw() % 50_000_000) * 1_000_000n + BigInt(draw() % 1_000_000);
    const bps = draw() % 10_001;
    const fee = feeFromBps(nav, bps);
    const scaled = nav * BigInt(bps);
    assert.ok(fee * 10_000n >= scaled);
    assert.ok(fee * 10_000n < scaled + 10_000n);
  }
  assert.equal(feeFromBps(1n, 1), 1n);
  assert.equal(feeFromBps(10_000n, 1), 1n);
  assert.equal(feeFromBps(0n, 10_000), 0n);
});

test("fee is monotone in bps and is the floor or one unit above it", () => {
  const draw = next(0x0fee);
  for (let i = 0; i < TRIALS; i++) {
    const nav = BigInt(draw() % 50_000_000) * 1_000_000n + BigInt(draw() % 1_000_000);
    assert.equal(feeFromBps(nav, 0), 0n);
    assert.equal(feeFromBps(nav, 10_000), nav);
    let previous = 0n;
    for (let bps = 0; bps <= 10_000; bps += 500) {
      const fee = feeFromBps(nav, bps);
      const floor = (nav * BigInt(bps)) / 10_000n;
      assert.ok(fee === floor || fee === floor + 1n);
      assert.ok(fee >= previous);
      previous = fee;
    }
  }
});

test("stage-1 bps follows the constructor curve and does not clamp", () => {
  const draw = next(0x99);
  let previous = 0;
  for (let seconds = 1n; seconds <= 20_000n; seconds += 1n) {
    const raw = (1_200n * seconds * 4_320n + YEAR / 2n) / YEAR;
    const expected = Number(raw < 25n ? 25n : raw);
    assert.equal(modelFeeBps(seconds), expected);
    assert.ok(expected >= previous);
    previous = expected;
  }
  for (let i = 0; i < TRIALS; i++) {
    const seconds = BigInt((draw() % 400_000) + 1);
    const again = modelFeeBps(seconds);
    const later = modelFeeBps(seconds + 1n);
    assert.ok(later >= again);
  }
  assert.ok(modelFeeBps(86_400n) > 1_500);
});

test("USDG text round-trips across 256 amounts and rejects the boundaries", () => {
  const draw = next(0x0a11);
  for (let i = 0; i < TRIALS; i++) {
    const raw = BigInt(draw() % 20_000_000_000);
    assert.equal(parseUsdg(formatUsdg(raw)), raw);
  }
  for (const bad of ["", "-1", "1.1234567", "1e6", "0x10", "1.", ".5", " 1"]) {
    assert.throws(() => parseUsdg(bad), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  }
  assert.throws(() => parseBps("-1"), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.throws(() => parseBps("10001"), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.equal(parseUsdg("0"), 0n);
  assert.equal(parseUsdg("0.000001"), 1n);
});
