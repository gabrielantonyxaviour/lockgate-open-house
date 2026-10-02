import assert from "node:assert/strict";
import { test } from "node:test";
import { scenarioSchema } from "../src/schema.js";
import { runOnce } from "../src/simulate.js";
import { scenarioSet } from "../src/scenarios.js";

test("a short path keeps the identity, repay-first, fee bounds and loss order", () => {
  const scenario = scenarioSchema.parse({ ...scenarioSet(60)[0]!, horizonDays: 60 });
  for (const stage of ["stage1", "stage2", "stage3"] as const) {
    const run = runOnce(stage, scenario, 20261001, false);
    assert.equal(run.breaches, 0);
    assert.equal(run.lockgateSwept, 0);
    assert.equal(run.advanced, 595);
    const yieldBps = Number((BigInt(run.realizedFees) * 10_000n * 365n) / BigInt(run.avgEquity) / BigInt(run.horizonDays));
    assert.equal(run.feeYieldBps, yieldBps);
    assert.equal(run.feeYieldBps, { stage1: 1727, stage2: 3192, stage3: 25548 }[stage]);
  }
});

test("default losses exceed baseline, and a bank-run uses more of the book", () => {
  const [baseline, , shock, , run] = scenarioSet(120);
  const calm = runOnce("stage1", baseline!, 20261001, false);
  const stressed = runOnce("stage1", shock!, 20261001, false);
  const rush = runOnce("stage1", run!, 20261001, false);
  assert.ok(stressed.reserveAbsorbed + stressed.creditLossEquity > calm.reserveAbsorbed + calm.creditLossEquity);
  assert.equal(calm.reserveAbsorbed + calm.creditLossEquity, 0);
  assert.equal(calm.peakUtilBps, 4076);
  assert.equal(rush.peakUtilBps, 8553);
  assert.equal(calm.requested, 1738);
  assert.equal(rush.requested, 5056);
});
