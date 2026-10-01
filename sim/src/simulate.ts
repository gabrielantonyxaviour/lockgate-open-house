import { assertLine, equityValue, type Line } from "./books.js";
import { fail } from "./errors.js";
import { fundExit } from "./fund.js";
import { MAX_FEE_BPS, MIN_FEE_BPS, TECH_FEE_USDG_PER_VAULT_PER_30D, u } from "./params.js";
import { makeRng, normal, poisson, type Rng } from "./rng.js";
import type { Scenario, Stage } from "./schema.js";
import { enforceLates, processWindow } from "./window.js";
import { accrueAndPay, buildWorld, pullFacility, type Platform, type World } from "./world.js";

export type PathPoint = { day: number; utilBps: number; cumLoss: number; cumFees: number };

export type RunResult = {
  stage: Stage;
  scenario: string;
  seed: number;
  horizonDays: number;
  requested: number;
  advanced: number;
  rejected: Record<string, number>;
  realizedFees: number;
  techFee: number;
  reserveAbsorbed: number;
  juniorLoss: number;
  seniorLoss: number;
  creditLossEquity: number;
  interestExpense: number;
  openPrincipal: number;
  peakUtilBps: number;
  avgUtilBps: number;
  avgEquity: number;
  feeYieldBps: number | null;
  breaches: number;
  lockgateSwept: number;
  path: PathPoint[];
};

const EARLY = 0.7;

function lambda(kind: Platform["kind"]): number {
  if (kind === "weekly") return 0.55;
  if (kind === "epoch") return 0.3;
  return 0.12;
}

function sampleNav(rng: Rng): number {
  const whole = Math.exp(Math.log(12_000) + 0.5 * normal(rng));
  return Math.min(40_000, Math.max(800, Math.round(whole))) * 1_000_000;
}

function isGated(platform: Platform, day: number, scenario: Scenario): boolean {
  if (scenario.gateMode === "scheduled") {
    if (platform.kind === "quarterly" && day <= 90) return true;
    if (platform.kind === "epoch" && day >= 40 && day <= 70) return true;
  }
  if (scenario.bankRunGates && platform.gateInRun && day >= scenario.runStart && day <= scenario.runEnd) {
    return true;
  }
  return false;
}

function bookUtil(lines: readonly Line[]): number {
  let principal = 0;
  let idle = 0;
  for (const line of lines) {
    principal += line.principal;
    idle += Math.max(0, line.balance - line.reserve);
  }
  const denom = principal + idle;
  return denom <= 0 ? 0 : Math.floor((principal * 10_000) / denom);
}

function sumFees(lines: readonly Line[]): number {
  let n = 0;
  for (const line of lines) n += line.realizedFees;
  return n;
}

function sumLoss(world: World): number {
  let n = (world.facility?.juniorLoss ?? 0) + (world.facility?.seniorLoss ?? 0);
  for (const line of world.lines) n += line.reserveAbsorbed + line.creditLossEquity;
  return n;
}

function assertBook(world: World): void {
  for (const line of world.lines) assertLine(line);
  const facility = world.facility;
  const line = world.lines[0];
  if (facility && line) {
    if (line.juniorDebt !== facility.juniorDrawn || line.seniorDebt !== facility.seniorDrawn) {
      fail("facility draw drifted from the credit line", "solvency");
    }
    if (facility.seniorLoss > 0 && (facility.juniorCash > 0 || line.juniorDebt > 0)) {
      fail("senior took a loss while junior was still in front", "waterfall");
    }
  }
  if (world.breaches !== 0) fail("investor paid while an advance was unpaid", "repay-first");
  if (world.lockgateSwept !== 0) fail("lockgate swept partner funds", "keys");
}

function annualizedBps(fees: number, avgEquity: number, horizon: number): number | null {
  if (avgEquity <= 0 || horizon <= 0) return null;
  return Number((BigInt(fees) * 10_000n * 365n) / BigInt(avgEquity) / BigInt(horizon));
}

export function runOnce(stage: Stage, scenario: Scenario, seed: number, keepPath: boolean): RunResult {
  const world = buildWorld(stage, seed);
  const arrival = makeRng(seed ^ 0xa11);
  const size = makeRng(seed ^ 0x51fe);
  const early = makeRng(seed ^ 0xea21);
  const cash = makeRng(seed ^ 0xca54);
  const path: PathPoint[] = [];
  let utilSum = 0;
  let equitySum = 0;
  let peak = 0;
  for (let day = 1; day <= scenario.horizonDays; day += 1) {
    const line = world.lines[0];
    if (world.facility && line) {
      accrueAndPay(line, world.facility);
      pullFacility(line, world.facility);
    }
    if (stage === "stage2" && day % 30 === 0) {
      world.techFee += world.vaults.length * u(TECH_FEE_USDG_PER_VAULT_PER_30D);
    }
    const rush = scenario.runMultiplier > 1 && day >= scenario.runStart && day <= scenario.runEnd;
    for (const platform of world.platforms) {
      platform.navAgeDays += 1;
      const gated = isGated(platform, day, scenario);
      if (!gated && day % 3 === platform.refreshPhase) platform.navAgeDays = 0;
      if (day === platform.nextWindow) processWindow(world, platform, day, scenario, cash);
      const n = poisson(arrival, lambda(platform.kind) * (rush ? scenario.runMultiplier : 1));
      for (let i = 0; i < n; i += 1) {
        const nav = sampleNav(size);
        if (early.bool(EARLY)) fundExit(world, platform, nav, day, platform.nextWindow, gated);
        else queueWait(world, platform, nav);
      }
    }
    enforceLates(world, day, scenario);
    assertBook(world);
    const util = bookUtil(world.lines);
    utilSum += util;
    peak = Math.max(peak, util);
    let equity = 0;
    for (const book of world.lines) equity += Math.max(0, equityValue(book));
    equitySum += equity;
    if (keepPath) path.push({ day, utilBps: util, cumLoss: sumLoss(world), cumFees: sumFees(world.lines) });
  }
  assertFees(world);
  const avgEquity = Math.floor(equitySum / scenario.horizonDays);
  return {
    stage,
    scenario: scenario.name,
    seed,
    horizonDays: scenario.horizonDays,
    requested: world.requested,
    advanced: world.advanced,
    rejected: world.rejected,
    realizedFees: sumFees(world.lines),
    techFee: world.techFee,
    reserveAbsorbed: world.lines.reduce((n, book) => n + book.reserveAbsorbed, 0),
    juniorLoss: world.facility?.juniorLoss ?? 0,
    seniorLoss: world.facility?.seniorLoss ?? 0,
    creditLossEquity: world.lines.reduce((n, book) => n + book.creditLossEquity, 0),
    interestExpense: world.lines.reduce((n, book) => n + book.interestExpense, 0),
    openPrincipal: world.lines.reduce((n, book) => n + book.principal, 0),
    peakUtilBps: peak,
    avgUtilBps: Math.floor(utilSum / scenario.horizonDays),
    avgEquity,
    feeYieldBps: annualizedBps(sumFees(world.lines), avgEquity, scenario.horizonDays),
    breaches: world.breaches,
    lockgateSwept: world.lockgateSwept,
    path,
  };
}

function queueWait(world: World, platform: Platform, nav: number): void {
  world.requested += 1;
  platform.reqs.push({
    nav, fee: 0, principal: 0, advanced: false, dueDay: platform.nextWindow, open: true,
    line: null, platform: platform.id, feeBps: 0, misses: 0, lastMissDay: -1,
  });
}

function assertFees(world: World): void {
  for (const platform of world.platforms) {
    for (const req of platform.reqs) {
      if (!req.advanced) continue;
      if (req.feeBps < MIN_FEE_BPS || req.feeBps > MAX_FEE_BPS) {
        fail(`fee ${req.feeBps} outside ${MIN_FEE_BPS}-${MAX_FEE_BPS}`, "fee-bounds");
      }
    }
  }
}
