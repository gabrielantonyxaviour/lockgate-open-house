import assert from "node:assert/strict";
import { test } from "node:test";
import { percentile } from "../src/format.js";
import { coverageBps, creditLoss, renderHorizon } from "../src/horizon.js";
import { isGated, runOnce, type RunResult } from "../src/simulate.js";
import { HORIZON_DAYS, MIXED, mixedHorizon, mixedKindGated, scenarioSet, yearDay } from "../src/scenarios.js";
import { missLimit } from "../src/window.js";
import type { Platform } from "../src/world.js";

test("the reference book stays five single shocks", () => {
  const names = scenarioSet(360).map((scenario) => scenario.name);
  assert.deepEqual(names, ["baseline", "gating", "default", "depeg", "bank-run"]);
});

test("the mixed calendar places gates, a depeg, and a bank-run on a 1080-day path", () => {
  const mixed = mixedHorizon();
  assert.equal(mixed.horizonDays, HORIZON_DAYS);
  assert.equal(mixed.name, "mixed");
  assert.ok(mixed.depegEnd < mixed.runStart);
  assert.equal(yearDay(1), 1);
  assert.equal(yearDay(360), 360);
  assert.equal(yearDay(361), 1);
  assert.equal(yearDay(400), 40);
  assert.equal(mixedKindGated("quarterly", 400), true);
  assert.equal(mixedKindGated("quarterly", 451), false);
  assert.equal(mixedKindGated("epoch", 40), true);
  assert.equal(mixedKindGated("epoch", 39), false);
  assert.equal(mixedKindGated("weekly", 50), false);
});

test("gates on the mixed path repeat, and the single-shock gate does not", () => {
  const mixed = mixedHorizon();
  const gating = scenarioSet(360)[1]!;
  const quiet = { kind: "quarterly" as const, gateInRun: false };
  const flagged = { kind: "weekly" as const, gateInRun: true };
  assert.equal(isGated(quiet, 400, mixed), true);
  assert.equal(isGated(quiet, 451, mixed), false);
  assert.equal(isGated(quiet, 90, gating), true);
  assert.equal(isGated(quiet, 100, gating), false);
  assert.equal(isGated(flagged, 730, mixed), true);
  assert.equal(isGated(flagged, 700, mixed), false);
});

test("miss limits follow the window on a mixed path and stay put on a named shock", () => {
  const mixed = mixedHorizon();
  const platform = { id: "p02" } as Platform;
  const defaulter = { id: "p00" } as Platform;
  assert.equal(missLimit(mixed, platform, 100), 8);
  assert.equal(missLimit(mixed, platform, 400), 3);
  assert.equal(missLimit(mixed, platform, 730), 2);
  assert.equal(missLimit(mixed, defaulter, 730), 1);
  const bank = scenarioSet(120)[4]!;
  const depeg = scenarioSet(120)[3]!;
  assert.equal(missLimit(bank, platform, 1), 2);
  assert.equal(missLimit(depeg, platform, 1), 3);
  assert.equal(MIXED.defaultCount, 2);
});

test("nearest rank takes ceil of the percentile", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(values, 25), 30);
  assert.equal(percentile(values, 75), 80);
  assert.equal(percentile([], 50), 0);
});

test("one mixed seed is deterministic and stays inside the book rules", () => {
  const scenario = mixedHorizon();
  const first = runOnce("stage1", scenario, 20261001, false);
  const second = runOnce("stage1", scenario, 20261001, false);
  assert.equal(first.breaches, 0);
  assert.equal(first.lockgateSwept, 0);
  assert.equal(first.horizonDays, 1_080);
  assert.deepEqual(snapshot(first), snapshot(second));
  for (const stage of ["stage2", "stage3"] as const) {
    const run = runOnce(stage, scenario, 20261001, false);
    assert.equal(run.breaches, 0);
    assert.equal(run.lockgateSwept, 0);
    assert.ok(run.advanced > 0, stage);
    assertPartialReserve(run);
  }
  assertPartialReserve(first);
});

test("the horizon report separates a clean path from reserve coverage", () => {
  const clean = fixture("stage1", 20261001, { reserveLeft: 50_000_000 });
  const hit = fixture("stage1", 20261002, {
    reserveAbsorbed: 300_000_000,
    creditLossEquity: 100_000_000,
    reserveLeft: 20_000_000,
  });
  const text = renderHorizon([clean, hit]);
  assert.equal(coverageBps(clean), null);
  assert.equal(coverageBps(hit), 7_500);
  assert.equal(creditLoss(hit), 400_000_000);
  assert.match(text, /1080 days/);
  assert.match(text, /no loss/);
  assert.match(text, /75\.00%/);
  assert.match(text, /20261001/);
  assert.doesNotMatch(text, /100\.00%/);
});

function assertPartialReserve(run: RunResult): void {
  const loss = creditLoss(run);
  assert.ok(loss > run.reserveAbsorbed, run.stage);
  assert.ok(run.reserveAbsorbed > 0, run.stage);
  assert.equal(coverageBps(run), Math.floor((run.reserveAbsorbed * 10_000) / loss));
}

function snapshot(run: RunResult): number[] {
  return [creditLoss(run), run.reserveAbsorbed, run.reserveLeft, run.juniorLoss, run.seniorLoss, run.advanced];
}

function fixture(stage: RunResult["stage"], seed: number, patch: Partial<RunResult>): RunResult {
  return {
    stage,
    scenario: "mixed",
    seed,
    horizonDays: 1080,
    requested: 1,
    advanced: 1,
    rejected: {},
    realizedFees: 0,
    techFee: 0,
    reserveAbsorbed: 0,
    reserveLeft: 0,
    juniorLoss: 0,
    seniorLoss: 0,
    creditLossEquity: 0,
    interestExpense: 0,
    openPrincipal: 0,
    peakUtilBps: 0,
    avgUtilBps: 0,
    avgEquity: 1,
    feeYieldBps: 0,
    breaches: 0,
    lockgateSwept: 0,
    path: [],
    gatedHits: {},
    sameDayGateDays: 0,
    sameDayGateOn: [],
    exposurePeaks: { platform: {}, mandate: {}, concentrationGap: {} },
    ...patch,
  };
}
