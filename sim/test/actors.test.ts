import assert from "node:assert/strict";
import { test } from "node:test";
import { frontRunRepayment, griefSharedIdle, mandateAbuse, runActors } from "../src/actors.js";

test("a front-run record keeps the honest vault unpaid", () => {
  const report = frontRunRepayment();
  assert.equal(report.broke, true);
  assert.match(report.steps[2], /pays 100000000 to grief/);
  assert.match(report.steps[4], /honest/);
});

test("shared idle is not paid out twice", () => {
  const report = griefSharedIdle();
  assert.equal(report.broke, false);
  assert.match(report.steps[2], /capital-short/);
  assert.match(report.steps[3], /over-limit/);
});

test("mandate abuse is refused before an advance exists", () => {
  const report = mandateAbuse();
  assert.equal(report.broke, false);
  assert.match(report.steps[0], /mandate-platform/);
  assert.match(report.steps[3], /a breach/);
});

test("the actor set names one break", () => {
  const broke = runActors().filter((report) => report.broke).map((report) => report.id);
  assert.deepEqual(broke, ["front-run-repay"]);
});
