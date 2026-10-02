import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHorizon, runHorizon } from "../src/horizon.js";
import { renderReport } from "../src/report.js";
import { scenarioSet } from "../src/scenarios.js";
import { runOnce, type RunResult } from "../src/simulate.js";

const SEED = 20261001;
const DAYS = 360;
const STAGES = ["stage1", "stage2", "stage3"] as const;

test("the same seed reproduces byte-identical sim output across two runs", () => {
  const first = bundle(SEED);
  const second = bundle(SEED);
  assertSameBytes("summary", first.summary, second.summary);
  assertSameBytes("report", first.report, second.report);
  assertSameBytes("horizon", first.horizon, second.horizon);
  assertSameBytes("horizon report", first.horizonReport, second.horizonReport);
  const other = bundle(SEED + 1);
  assert.equal(first.summary.equals(other.summary), false);
  assert.equal(JSON.parse(first.summary.toString()).illustratedSeed, SEED);
  assert.equal(JSON.parse(other.summary.toString()).illustratedSeed, SEED + 1);
});

function bundle(seed: number): {
  summary: Buffer;
  report: Buffer;
  horizon: Buffer;
  horizonReport: Buffer;
} {
  const runs = book(seed);
  const horizonRuns = runHorizon([seed]);
  const summary = JSON.stringify({
    illustratedSeed: seed,
    horizonDays: DAYS,
    seeds: [seed],
    runs,
  });
  const horizon = JSON.stringify({ horizonDays: horizonRuns[0]?.horizonDays ?? 0, runs: horizonRuns });
  return {
    summary: Buffer.from(summary, "utf8"),
    report: Buffer.from(renderReport(runs, seed), "utf8"),
    horizon: Buffer.from(horizon, "utf8"),
    horizonReport: Buffer.from(renderHorizon(horizonRuns), "utf8"),
  };
}

function book(seed: number): RunResult[] {
  const runs: RunResult[] = [];
  for (const stage of STAGES) {
    for (const scenario of scenarioSet(DAYS)) {
      runs.push(runOnce(stage, scenario, seed, true));
    }
  }
  return runs;
}

function assertSameBytes(label: string, left: Buffer, right: Buffer): void {
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    if (left[i] !== right[i]) assert.fail(`${label} differs at byte ${i}`);
  }
  assert.equal(left.length, right.length, label);
}
