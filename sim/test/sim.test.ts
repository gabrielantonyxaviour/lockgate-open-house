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
    assert.ok(run.advanced > 0, stage);
    assert.ok(run.feeYieldBps === null || run.feeYieldBps >= 0);
  }
});

test("default losses exceed baseline, and a bank-run uses more of the book", () => {
  const [baseline, , shock, , run] = scenarioSet(120);
  const calm = runOnce("stage1", baseline!, 20261001, false);
  const stressed = runOnce("stage1", shock!, 20261001, false);
  const rush = runOnce("stage1", run!, 20261001, false);
  assert.ok(stressed.reserveAbsorbed + stressed.creditLossEquity > calm.reserveAbsorbed + calm.creditLossEquity);
  assert.ok(rush.peakUtilBps >= calm.peakUtilBps);
  assert.ok(rush.requested > calm.requested);
});
