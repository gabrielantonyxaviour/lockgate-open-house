import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rng } from "../src/rng.js";
import { scenarioSchema } from "../src/schema.js";
import { mixedHorizon, scenarioSet } from "../src/scenarios.js";
import { coverageFactor } from "../src/window.js";
import type { Platform } from "../src/world.js";

const steady: Rng = { next: () => 1, int: () => 0, bool: () => false };
const weekly = { id: "p05", kind: "weekly" } as Platform;
const defaulter = { id: "p00", kind: "weekly" } as Platform;

test("depeg multiplies window cash by 0.92 inside the window and leaves the days outside", () => {
  const depeg = scenarioSet(360)[3]!;
  assert.equal(depeg.depegFactor, 0.92);
  assert.equal(coverageFactor(depeg, weekly, 119, steady), 1);
  assert.equal(coverageFactor(depeg, weekly, 120, steady), 0.92);
  assert.equal(coverageFactor(depeg, weekly, 150, steady), 0.92);
  assert.equal(coverageFactor(depeg, weekly, 151, steady), 1);
  const half = scenarioSchema.parse({ ...depeg, depegFactor: 0.5 });
  assert.equal(coverageFactor(half, weekly, 120, steady), 0.5);
  assert.equal(coverageFactor(half, weekly, 119, steady), 1);
});

test("a mixed depeg uses the same 0.92 factor and does not read a price", () => {
  const mixed = mixedHorizon();
  assert.equal(coverageFactor(mixed, weekly, 359, steady), 1);
  assert.equal(coverageFactor(mixed, weekly, 360, steady), 0.92);
  assert.equal(coverageFactor(mixed, weekly, 420, steady), 0.92);
  assert.equal(coverageFactor(mixed, weekly, 421, steady), 1);
  assert.equal(coverageFactor(mixed, defaulter, 360, steady), 0);
  assert.equal(coverageFactor(mixed, defaulter, 100, steady), 0);
  const half = scenarioSchema.parse({ ...mixed, depegFactor: 0.5 });
  assert.equal(coverageFactor(half, weekly, 360, steady), 0.5);
  assert.equal(coverageFactor(half, defaulter, 360, steady), 0);
});
