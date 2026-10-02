import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TRI_GATE_END,
  TRI_GATE_IDS,
  TRI_GATE_START,
  renderConcurrent,
  runTriGateBook,
  triGateScenario,
  type TriRow,
} from "../src/concurrent.js";
import { fundExit } from "../src/fund.js";
import { emptyPeaks, scanLimits } from "../src/mandate.js";
import { u } from "../src/params.js";
import { isGated, runOnce } from "../src/simulate.js";
import { scenarioSet } from "../src/scenarios.js";
import { buildWorld, type World } from "../src/world.js";

const SEED = 20261001;
const DAYS = 360;
const PLATFORM = 150_000_000_000;
const HARBOUR = 80_000_000_000;
const KEPPEL = 100_000_000_000;
const MARINA = 120_000_000_000;

test("three named platforms share one window and the five-name set stays closed", () => {
  const tri = triGateScenario(DAYS);
  const stressed = triGateScenario(DAYS, "default");
  const names = scenarioSet(DAYS).map((row) => row.name);
  assert.deepEqual(names, ["baseline", "gating", "default", "depeg", "bank-run"]);
  assert.equal(scenarioSet(DAYS).every((row) => row.gateIds.length === 0), true);
  assert.equal(scenarioSet(DAYS).find((row) => row.name === "depeg")?.depegFactor, 0.92);
  assert.equal(tri.name, "tri-gate");
  assert.equal(tri.gateMode, "none");
  assert.equal(tri.bankRunGates, false);
  assert.equal(tri.depegFactor, 1);
  assert.equal(tri.defaultCount, 0);
  assert.deepEqual(tri.gateIds, [...TRI_GATE_IDS]);
  assert.equal(tri.gateStart, TRI_GATE_START);
  assert.equal(tri.gateEnd, TRI_GATE_END);
  assert.equal(stressed.defaultCount, 4);
  assert.equal(stressed.depegFactor, 1);
  assert.deepEqual(stressed.gateIds, [...TRI_GATE_IDS]);
  const gating = scenarioSet(DAYS)[1]!;
  const weekly = { id: "p00", kind: "weekly" as const, gateInRun: false };
  const epoch = { id: "p18", kind: "epoch" as const, gateInRun: false };
  const quarterly = { id: "p30", kind: "quarterly" as const, gateInRun: false };
  assert.equal(TRI_GATE_END - TRI_GATE_START + 1, 90);
  for (let day = TRI_GATE_START; day <= TRI_GATE_END; day += 1) {
    assert.equal(isGated(weekly, day, tri), true, String(day));
    assert.equal(isGated(epoch, day, tri), true, String(day));
    assert.equal(isGated(quarterly, day, tri), true, String(day));
    assert.equal(isGated({ id: "p01", kind: "weekly", gateInRun: false }, day, tri), false, String(day));
    assert.equal(isGated({ id: "p19", kind: "epoch", gateInRun: false }, day, tri), false, String(day));
    assert.equal(isGated({ id: "p31", kind: "quarterly", gateInRun: false }, day, tri), false, String(day));
  }
  assert.equal(isGated(weekly, TRI_GATE_END + 1, tri), false);
  assert.equal(isGated(weekly, 50, gating), false);
  assert.equal(isGated({ kind: "quarterly", gateInRun: false }, 50, gating), true);
  assert.equal(isGated({ id: "p31", kind: "quarterly", gateInRun: false }, 50, gating), true);
  assert.equal(isGated({ id: "p31", kind: "quarterly", gateInRun: false }, 50, tri), false);
});

const rows = runTriGateBook(SEED, DAYS);

const BOOK: readonly TriRow[] = [
  { id: "baseline", stage: "stage1", advanced: 3457, gated: 47, hits: [26, 16, 5], otherHits: 0, mandateLimit: 0, mandateConcentration: 0, overLimit: 70, creditLoss: 0, reserveAbsorbed: 0, reserveLeft: 405000000000, reservePosted: 405000000000, coverageBps: null, seniorLoss: 0, juniorLoss: 0, creditLossEquity: 0, platformPeak: 149338000000, harbourPeak: 0, keppelPeak: 0, marinaPeak: 0, concentrationGaps: 0, maxConcentrationGap: 0, sameDayGates: 1, sameDayOn: [27] },
  { id: "default", stage: "stage1", advanced: 2946, gated: 47, hits: [26, 16, 5], otherHits: 0, mandateLimit: 0, mandateConcentration: 0, overLimit: 70, creditLoss: 239841176300, reserveAbsorbed: 37505576100, reserveLeft: 367494423900, reservePosted: 405000000000, coverageBps: 1563, seniorLoss: 0, juniorLoss: 0, creditLossEquity: 202335600200, platformPeak: 149338000000, harbourPeak: 0, keppelPeak: 0, marinaPeak: 0, concentrationGaps: 0, maxConcentrationGap: 0, sameDayGates: 1, sameDayOn: [27] },
  { id: "baseline", stage: "stage2", advanced: 3441, gated: 47, hits: [26, 16, 5], otherHits: 0, mandateLimit: 71, mandateConcentration: 0, overLimit: 0, creditLoss: 0, reserveAbsorbed: 0, reserveLeft: 360023825000, reservePosted: 360023825000, coverageBps: null, seniorLoss: 0, juniorLoss: 0, creditLossEquity: 0, platformPeak: 148979000000, harbourPeak: 78942000000, keppelPeak: 99905000000, marinaPeak: 119769000000, concentrationGaps: 0, maxConcentrationGap: 0, sameDayGates: 1, sameDayOn: [27] },
  { id: "default", stage: "stage2", advanced: 2929, gated: 47, hits: [26, 16, 5], otherHits: 0, mandateLimit: 71, mandateConcentration: 0, overLimit: 0, creditLoss: 239105333600, reserveAbsorbed: 14576975000, reserveLeft: 319007525000, reservePosted: 333584500000, coverageBps: 609, seniorLoss: 0, juniorLoss: 0, creditLossEquity: 224528358600, platformPeak: 148979000000, harbourPeak: 78053000000, keppelPeak: 99905000000, marinaPeak: 119769000000, concentrationGaps: 0, maxConcentrationGap: 0, sameDayGates: 1, sameDayOn: [27] },
  { id: "baseline", stage: "stage3", advanced: 3457, gated: 47, hits: [26, 16, 5], otherHits: 0, mandateLimit: 0, mandateConcentration: 0, overLimit: 70, creditLoss: 0, reserveAbsorbed: 0, reserveLeft: 405000000000, reservePosted: 405000000000, coverageBps: null, seniorLoss: 0, juniorLoss: 0, creditLossEquity: 0, platformPeak: 149338000000, harbourPeak: 0, keppelPeak: 0, marinaPeak: 0, concentrationGaps: 0, maxConcentrationGap: 0, sameDayGates: 1, sameDayOn: [27] },
  { id: "default", stage: "stage3", advanced: 2946, gated: 47, hits: [26, 16, 5], otherHits: 0, mandateLimit: 0, mandateConcentration: 0, overLimit: 70, creditLoss: 235628405300, reserveAbsorbed: 37505576100, reserveLeft: 367494423900, reservePosted: 405000000000, coverageBps: 1591, seniorLoss: 0, juniorLoss: 198122829200, creditLossEquity: 0, platformPeak: 149338000000, harbourPeak: 0, keppelPeak: 0, marinaPeak: 0, concentrationGaps: 0, maxConcentrationGap: 0, sameDayGates: 1, sameDayOn: [27] },
];

test("reserve coverage and mandate caps hold while three platforms are gated", () => {
  assert.equal(rows.length, BOOK.length);
  for (let i = 0; i < BOOK.length; i += 1) {
    const row = rows[i]!;
    assert.deepEqual(row, BOOK[i]);
    assert.equal(row.hits[0] + row.hits[1] + row.hits[2], row.gated);
    assert.equal(row.sameDayGates, row.sameDayOn.length);
    assert.deepEqual(row.sameDayOn, [27]);
    assert.ok(row.sameDayOn.every((day) => day >= TRI_GATE_START && day <= TRI_GATE_END));
    assert.ok(row.hits[0] > 0 && row.hits[1] > 0 && row.hits[2] > 0);
    assert.equal(row.otherHits, 0);
    assert.equal(row.reservePosted, row.reserveLeft + row.reserveAbsorbed);
    assert.equal(row.creditLoss, row.reserveAbsorbed + row.juniorLoss + row.creditLossEquity + row.seniorLoss);
    const formula = row.creditLoss <= 0 ? null : Math.floor((row.reserveAbsorbed * 10_000) / row.creditLoss);
    assert.equal(row.coverageBps, formula);
    assert.ok(row.platformPeak > 0 && row.platformPeak <= PLATFORM);
    assert.ok(row.harbourPeak <= HARBOUR);
    assert.ok(row.keppelPeak <= KEPPEL);
    assert.ok(row.marinaPeak <= MARINA);
    assert.equal(row.concentrationGaps, 0);
    assert.equal(row.maxConcentrationGap, 0);
    assert.equal(row.seniorLoss, 0);
    if (row.stage === "stage2") {
      assert.ok(row.harbourPeak > 0 && row.keppelPeak > 0 && row.marinaPeak > 0);
      assert.ok(row.mandateLimit > 0);
      assert.equal(row.overLimit, 0);
    } else {
      assert.equal(row.harbourPeak, 0);
      assert.equal(row.keppelPeak, 0);
      assert.equal(row.marinaPeak, 0);
      assert.equal(row.mandateLimit, 0);
      assert.ok(row.overLimit > 0);
    }
    if (row.id === "baseline") {
      assert.equal(row.creditLoss, 0);
      assert.equal(row.reserveAbsorbed, 0);
      assert.equal(row.coverageBps, null);
    } else if (row.stage === "stage3") {
      assert.ok(row.reserveAbsorbed > 0 && row.reserveAbsorbed < row.creditLoss);
      assert.equal(row.creditLossEquity, 0);
      assert.equal(row.juniorLoss, row.creditLoss - row.reserveAbsorbed);
    } else {
      assert.ok(row.reserveAbsorbed > 0 && row.reserveAbsorbed < row.creditLoss);
      assert.equal(row.juniorLoss, 0);
      assert.equal(row.creditLossEquity, row.creditLoss - row.reserveAbsorbed);
    }
  }
});

test("the same books without the three gates advance more and refuse none as gated", () => {
  for (const stage of ["stage1", "stage2", "stage3"] as const) {
    for (const name of ["baseline", "default"] as const) {
      const plainScenario = scenarioSet(DAYS).find((row) => row.name === name);
      const tri = rows.find((row) => row.stage === stage && row.id === name);
      assert.ok(plainScenario && tri);
      const plain = runOnce(stage, plainScenario, SEED, false);
      assert.equal(plain.rejected.gated ?? 0, 0);
      assert.equal(plain.sameDayGateDays, 0);
      assert.deepEqual(plain.sameDayGateOn, []);
      assert.equal(plain.breaches, 0);
      assert.equal(plain.lockgateSwept, 0);
      assert.ok(plain.advanced > tri.advanced);
    }
  }
});

test("CONCURRENT.md matches the renderer", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "CONCURRENT.md");
  const text = renderConcurrent(rows, SEED, DAYS);
  const changed = renderConcurrent(rows.map((row, index) => (index === 0 ? { ...row, gated: row.gated + 1 } : row)), SEED, DAYS);
  assert.notEqual(changed, text);
  assert.match(text, /day 27/);
  assert.match(text, /1563/);
  assert.match(text, /609/);
  assert.match(text, /1591/);
  assert.equal(readFileSync(path, "utf8"), text);
});

function owed(world: World, id: string): number {
  let n = 0;
  for (const line of world.lines) n += line.exposure[id] ?? 0;
  return n;
}

test("day 50 refuses p00, p18, and p30 together and still books p01", () => {
  const tri = triGateScenario(DAYS);
  const day = 50;
  assert.ok(day >= TRI_GATE_START && day <= TRI_GATE_END);
  for (const stage of ["stage1", "stage2", "stage3"] as const) {
    const world = buildWorld(stage, SEED);
    const named = TRI_GATE_IDS.map((id) => {
      const platform = world.platforms.find((row) => row.id === id);
      assert.ok(platform, id);
      assert.equal(isGated(platform, day, tri), true, id);
      return platform;
    });
    const open = world.platforms.find((row) => row.id === "p01");
    assert.ok(open);
    assert.equal(isGated(open, day, tri), false);
    for (const platform of named) fundExit(world, platform, u(1_000), day, day + 1, true);
    assert.equal(world.advanced, 0, stage);
    assert.deepEqual(world.rejected, { gated: 3 });
    assert.equal(world.lockgateSwept, 0);
    for (const id of TRI_GATE_IDS) {
      assert.equal(owed(world, id), 0, id);
      assert.equal(world.gatedHits?.[id], 1, id);
    }
    fundExit(world, open, u(1_000), day, day + 1, false);
    assert.equal(world.advanced, 1, stage);
    assert.equal(world.rejected.gated, 3, stage);
    assert.equal(world.lockgateSwept, 0);
    assert.ok(owed(world, "p01") > 0, stage);
    assert.ok(owed(world, "p01") <= open.limit, stage);
    for (const id of TRI_GATE_IDS) assert.equal(owed(world, id), 0, id);
    const peaks = emptyPeaks();
    scanLimits(stage, world.lines, world.vaults, world.platforms, peaks);
    assert.equal(peaks.platform.p01, owed(world, "p01"));
    assert.ok((peaks.platform.p01 ?? 0) <= open.limit);
    if (stage === "stage2") {
      const hits = Object.entries(peaks.mandate).filter(([key, value]) => key.endsWith(":p01") && value > 0);
      assert.equal(hits.length, 1);
      const [key, value] = hits[0]!;
      const vault = world.vaults.find((row) => row.id === key.split(":")[0]);
      assert.ok(vault);
      assert.ok(value <= vault.mandate.limit);
      assert.ok(vault.line.principal > 0);
    }
  }
});
