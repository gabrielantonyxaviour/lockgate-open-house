import assert from "node:assert/strict";
import { frontRunRepayment } from "./actors.js";
import {
  absorbLoss,
  canDraw,
  depositEquity,
  draw,
  emptyLine,
  postReserve,
  reserveNeed,
  residual,
  type Facility,
  type Line,
} from "./books.js";
import { fundExit } from "./fund.js";
import { mandateReject, type Mandate, type MandateInput } from "./mandate.js";
import { MAX_NAV_AGE_SECONDS, TECH_FEE_USDG_PER_VAULT_PER_30D, u } from "./params.js";
import { quoteFee, type QuoteInput } from "./pricing.js";
import type { Stage } from "./schema.js";
import { scenarioSet } from "./scenarios.js";
import { runOnce } from "./simulate.js";
import { buildWorld, DAY, type Platform, type World } from "./world.js";

export type NamedScenario = {
  id: string;
  stage: Stage;
  kind: "happy" | "failure";
  title: string;
  /** Outcome `run()` checks. No pipe characters: the renderer puts this in a table cell. */
  expect: string;
  run: () => void;
};

const SEED = 20261001;
const DAYS = 60;

const quoteBase: Omit<QuoteInput, "secondsToWindow"> = {
  navAgeSeconds: 0,
  gated: false,
  exposureBps: 0,
  utilizationBps: 0,
  riskBps: 10_000,
  timeScale: 1,
};

function happy(stage: Stage): { techFee: number; vaults: string[]; equity: number; senior: number; junior: number } {
  const scenario = scenarioSet(DAYS)[0];
  assert.ok(scenario);
  assert.equal(scenario.name, "baseline");
  const run = runOnce(stage, scenario, SEED, false);
  const world = buildWorld(stage, SEED);
  assert.equal(run.seed, SEED);
  assert.equal(run.horizonDays, DAYS);
  assert.equal(run.breaches, 0);
  assert.equal(run.lockgateSwept, 0);
  assert.ok(run.advanced > 0);
  const book = world.lines[0];
  assert.ok(book);
  return {
    techFee: run.techFee,
    vaults: world.vaults.map((vault) => vault.id),
    equity: book.equity,
    senior: world.facility?.seniorDeposited ?? 0,
    junior: world.facility?.juniorDeposited ?? 0,
  };
}

function stage1Book(): { world: World; platform: Platform } {
  const world = buildWorld("stage1", SEED);
  const platform = world.platforms[0];
  assert.ok(platform);
  return { world, platform };
}

function harbour(): { line: Line; mandate: Mandate } {
  const line = emptyLine();
  depositEquity(line, 10_000_000_000);
  return {
    line,
    mandate: {
      platforms: new Set(["harbour"]),
      limit: 5_000_000_000,
      minFeeBps: 25,
      maxTenorSeconds: 86_400,
      concentrationBps: 10_000,
      expiryDay: 10,
      paused: false,
    },
  };
}

function ask(platform: string, owed: number, patch: Partial<MandateInput> = {}): MandateInput {
  return { platform, day: 1, feeBps: 100, tenorSeconds: 600, principal: Math.max(0, owed - 1), owed, ...patch };
}

function mandateStays(reason: string, input: MandateInput): void {
  const { line, mandate } = harbour();
  const balance = line.balance;
  assert.equal(mandateReject(line, mandate, input), reason);
  assert.equal(line.balance, balance);
  assert.equal(line.principal, 0);
  assert.equal(line.reserve, 0);
}

function stage1Happy(): void {
  const run = happy("stage1");
  const world = buildWorld("stage1", SEED);
  assert.equal(world.lines.length, 1);
  assert.equal(world.vaults.length, 0);
  assert.equal(world.facility, null);
  assert.equal(run.equity, u(4_000_000));
  assert.equal(run.techFee, 0);
  assert.equal(run.vaults.length, 0);
}

function stage2Happy(): void {
  const run = happy("stage2");
  assert.deepEqual(run.vaults, ["Harbour", "Keppel", "Marina"]);
  assert.equal(run.techFee, 3 * u(TECH_FEE_USDG_PER_VAULT_PER_30D) * 2);
}

function stage3Happy(): void {
  const run = happy("stage3");
  assert.equal(run.equity, u(500_000));
  assert.equal(run.senior, u(1_500_000));
  assert.equal(run.junior, u(400_000));
  assert.equal(run.techFee, 0);
  assert.equal(run.vaults.length, 0);
}

function gated(): void {
  const quote = quoteFee({ ...quoteBase, secondsToWindow: DAY, gated: true });
  assert.deepEqual(quote, { available: false, bps: 0, reason: "gated" });
  const { world, platform } = stage1Book();
  fundExit(world, platform, u(1_000), 1, 8, true);
  assert.equal(world.requested, 1);
  assert.deepEqual(world.rejected, { gated: 1 });
  assert.equal(world.advanced, 0);
  assert.equal(platform.reqs.length, 0);
}

function staleNav(): void {
  const week = quoteFee({ ...quoteBase, secondsToWindow: DAY, navAgeSeconds: MAX_NAV_AGE_SECONDS });
  assert.equal(week.available, true);
  const late = quoteFee({ ...quoteBase, secondsToWindow: DAY, navAgeSeconds: MAX_NAV_AGE_SECONDS + 1 });
  assert.deepEqual(late, { available: false, bps: 0, reason: "stale-nav" });
  const refused = stage1Book();
  refused.platform.navAgeDays = 8;
  fundExit(refused.world, refused.platform, u(1_000), 1, 8, false);
  assert.deepEqual(refused.world.rejected, { "stale-nav": 1 });
  assert.equal(refused.world.advanced, 0);
  const fresh = stage1Book();
  fresh.platform.navAgeDays = 7;
  fundExit(fresh.world, fresh.platform, u(1_000), 1, 8, false);
  assert.equal(fresh.world.rejected["stale-nav"] ?? 0, 0);
  assert.equal(fresh.world.advanced, 1);
  assert.equal(fresh.platform.reqs.length, 1);
}

function tenor(): void {
  const quote = quoteFee({ ...quoteBase, secondsToWindow: 366 * DAY + 1 });
  assert.deepEqual(quote, { available: false, bps: 0, reason: "tenor" });
  const { world, platform } = stage1Book();
  fundExit(world, platform, u(1_000), 1, 1 + 367, false);
  assert.deepEqual(world.rejected, { tenor: 1 });
  assert.equal(world.advanced, 0);
  assert.equal(platform.reqs.length, 0);
}

function reserveShort(): void {
  const line = emptyLine();
  depositEquity(line, 20_000);
  postReserve(line, "p", 1);
  assert.equal(reserveNeed(10_001, 1), 2);
  assert.equal(Math.floor((10_001 * 1) / 10_000), 1);
  assert.deepEqual(canDraw(line, "p", 10_001, 10_001, 1, 100_000), { ok: false, reason: "reserve-short" });
  assert.equal(line.principal, 0);
}

function capitalShort(): void {
  const line = emptyLine();
  depositEquity(line, 20);
  postReserve(line, "p", 80);
  assert.equal(line.balance - line.reserve, 20);
  assert.deepEqual(canDraw(line, "p", 30, 30, 0, 1_000), { ok: false, reason: "capital-short" });
  assert.equal(line.principal, 0);
  assert.equal(line.balance - line.reserve, 20);
}

function frontRun(): void {
  const report = frontRunRepayment();
  assert.equal(report.id, "front-run-repay");
  assert.equal(report.broke, true);
  assert.equal(report.steps[2], "relayRepay(index 0) pays 100000000 to grief");
  assert.equal(report.steps[3], "a second relayRepay of index 0 is empty");
  assert.equal(report.steps[4], "still open: honest");
}

function juniorFirst(): void {
  const line = emptyLine();
  depositEquity(line, 100_000);
  postReserve(line, "p", 10_000);
  line.balance += 200_000;
  line.juniorDebt = 50_000;
  line.seniorDebt = 150_000;
  const pot: Facility = {
    seniorCash: 0, juniorCash: 20_000, seniorDrawn: 150_000, juniorDrawn: 50_000,
    seniorDeposited: 0, juniorDeposited: 70_000,
    seniorInterest: 0, juniorInterest: 0, interestPaid: 0,
    seniorLoss: 0, juniorLoss: 0, seniorAprBps: 800, juniorAprBps: 1_500,
    advanceRateBps: 8_000, covenantBps: 5_000,
  };
  draw(line, "p", 180_000);
  const split = absorbLoss(line, pot, "p", 180_000);
  assert.deepEqual(split, { reserve: 10_000, juniorCash: 20_000, juniorDebt: 50_000, equity: 100_000, senior: 0 });
  assert.equal(pot.seniorLoss, 0);
  assert.equal(line.seniorDebt, 150_000);
  assert.equal(line.juniorDebt, 0);
  assert.equal(residual(line), 0);
}

/** Three stage happy paths and the ten failure paths. This does not run them. */
export function scenarioLibrary(): readonly NamedScenario[] {
  return [
    { id: "stage1-happy", stage: "stage1", kind: "happy", title: "Stage 1 baseline books its own cash", expect: "Seed 20261001 on the 60-day baseline. One book, equity 4,000,000 USDG, zero vaults, no facility. Advances are booked. Breaches stay 0, Lockgate sweeps 0, and the technology fee stays 0. A returned run has kept the accounting identity.", run: stage1Happy },
    { id: "stage2-happy", stage: "stage2", kind: "happy", title: "Stage 2 baseline invoices three vaults", expect: "Same seed and baseline. Vaults are Harbour, Keppel, and Marina. The technology fee is 3 vaults times 2,000 USDG times 2 invoices, which is 12,000 USDG. Advances are booked. Breaches stay 0 and Lockgate sweeps 0.", run: stage2Happy },
    { id: "stage3-happy", stage: "stage3", kind: "happy", title: "Stage 3 baseline keeps senior and junior", expect: "Same seed and baseline. Equity is 500,000 USDG. Senior deposited is 1,500,000 USDG and junior deposited is 400,000 USDG. Advances are booked. Breaches stay 0, the technology fee stays 0, and Lockgate sweeps 0.", run: stage3Happy },
    { id: "gated", stage: "stage1", kind: "failure", title: "A gate refuses the quote and the draw", expect: "A gated quote is unavailable at 0 bps. fundExit on the stage-1 book sets requested to 1, records gated once, and books no advance.", run: gated },
    { id: "stale-nav", stage: "stage1", kind: "failure", title: "NAV age of 7 days is fresh and day 8 is stale", expect: "A quote aged exactly 7 days stays available. One second past that age is stale-nav at 0 bps. fundExit with navAgeDays 8 records stale-nav and books no advance. fundExit with navAgeDays 7 books the advance.", run: staleNav },
    { id: "tenor", stage: "stage1", kind: "failure", title: "A wait past 366 days is refused", expect: "A wait of 366 days plus 1 second is tenor at 0 bps. fundExit 367 days out records tenor and books no advance.", run: tenor },
    { id: "reserve-short", stage: "stage1", kind: "failure", title: "Reserve rounds up and a short post blocks the draw", expect: "Ceiling reserve on 10,001 at 1 bp is 2. The floored amount is 1. Posting 1 and asking to draw 10,001 against a 100,000 limit is reserve-short, and principal stays 0.", run: reserveShort },
    { id: "capital-short", stage: "stage1", kind: "failure", title: "Idle cash outside the reserve cannot fund the principal", expect: "Equity of 20 plus a posted reserve of 80 leaves 20 of idle cash. A principal of 30 at 0 reserve bps against a 1,000 limit is capital-short, and that idle cash stays 20.", run: capitalShort },
    { id: "mandate-platform", stage: "stage2", kind: "failure", title: "An unapproved platform is refused", expect: "A platform outside the approved set is mandate-platform. Balance, principal, and reserve stay unchanged.", run: () => mandateStays("mandate-platform", ask("stranger", 1_000_000)) },
    { id: "mandate-fee", stage: "stage2", kind: "failure", title: "A fee under the mandate floor is refused", expect: "24 bps on an approved platform is mandate-fee. Balance, principal, and reserve stay unchanged.", run: () => mandateStays("mandate-fee", ask("harbour", 1_000_000_000, { feeBps: 24 })) },
    { id: "mandate-tenor", stage: "stage2", kind: "failure", title: "A tenor past the mandate max is refused", expect: "A tenor of 86,401 seconds is mandate-tenor. Balance, principal, and reserve stay unchanged.", run: () => mandateStays("mandate-tenor", ask("harbour", 1_000_000, { tenorSeconds: 86_401 })) },
    { id: "front-run-repay", stage: "stage2", kind: "failure", title: "One repay clears only the front-run record", expect: "The open break still reproduces. relayRepay of index 0 pays 100,000,000 to the grief vault. A second call on index 0 is empty. The honest vault stays open.", run: frontRun },
    { id: "junior-before-senior", stage: "stage3", kind: "failure", title: "Junior and equity absorb before senior", expect: "A 180,000 write-off takes 10,000 from that platform reserve, 20,000 of junior cash, 50,000 of junior debt, and 100,000 of equity. Senior loss stays 0. The identity residual stays 0.", run: juniorFirst },
  ];
}

/** Markdown catalog. Does not call `run()`. */
export function renderLibrary(rows: readonly NamedScenario[] = scenarioLibrary()): string {
  const happyCount = rows.filter((row) => row.kind === "happy").length;
  const failureCount = rows.filter((row) => row.kind === "failure").length;
  const lines = [
    "# SUMMARY",
    "",
    `${rows.length} named scenarios. ${happyCount} happy paths, one per stage, use seed 20261001 and a 60-day baseline. ${failureCount} failure paths name the refusal or the loss split. \`front-run-repay\` passes while the break still reproduces. Each expected outcome is what \`run()\` checks. This page does not execute them.`,
    "",
    "```mermaid",
    "flowchart LR",
    "  lib[Scenario library] --> s1[Stage 1]",
    "  lib --> s2[Stage 2]",
    "  lib --> s3[Stage 3]",
    "  s1 --> h1[Own book]",
    "  s1 --> f1[Gate, stale NAV, tenor, reserve, capital]",
    "  s2 --> h2[Three vaults]",
    "  s2 --> f2[Platform, fee, tenor, front-run]",
    "  s3 --> h3[Senior and junior]",
    "  s3 --> f3[Junior before senior]",
    "```",
    "",
    "| Id | Stage | Kind | Expected |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.id} | ${row.stage} | ${row.kind} | ${row.expect} |`),
    "",
  ];
  for (const row of rows) {
    lines.push(`## ${row.id}`, "", row.title, "", row.expect, "");
  }
  return `${lines.join("\n")}\n`;
}
