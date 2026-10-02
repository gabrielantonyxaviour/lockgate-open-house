import { absorbLoss } from "./books.js";
import { settleAdvance } from "./fund.js";
import { scaleRepayment } from "./oracle.js";
import { GRACE_DAYS } from "./params.js";
import type { Rng } from "./rng.js";
import type { Scenario } from "./schema.js";
import type { ExitReq, Platform, World } from "./world.js";

function mixedRun(scenario: Scenario, day: number): boolean {
  return scenario.name === "mixed" && scenario.runMultiplier > 1 && day >= scenario.runStart && day <= scenario.runEnd;
}

function mixedDepeg(scenario: Scenario, day: number): boolean {
  return scenario.name === "mixed" && scenario.depegFactor < 1 && day >= scenario.depegStart && day <= scenario.depegEnd;
}

/** Misses before a write-off. On a mixed path the depeg and bank-run limits apply only inside those windows. */
export function missLimit(scenario: Scenario, platform: Platform, day = 0): number {
  const index = Number(platform.id.slice(1));
  if (index < scenario.defaultCount) return 1;
  if (scenario.name === "bank-run" || mixedRun(scenario, day)) return 2;
  if (scenario.name === "depeg" || mixedDepeg(scenario, day)) return 3;
  return 8;
}

export function coverageFactor(scenario: Scenario, platform: Platform, day: number, rng: Rng): number {
  const index = Number(platform.id.slice(1));
  let factor = 1;
  if (scenario.mildShortfall && platform.kind !== "quarterly" && rng.bool(0.35)) factor = 0.75;
  if (index < scenario.defaultCount) factor = 0;
  if (scenario.depegFactor < 1 && day >= scenario.depegStart && day <= scenario.depegEnd) {
    factor *= scenario.depegFactor;
  }
  if (scenario.runMultiplier > 1 && day >= scenario.runStart && day <= scenario.runEnd) {
    factor *= scenario.runCoverage;
  }
  return factor;
}

function due(reqs: readonly ExitReq[], day: number, advanced: boolean): ExitReq[] {
  return reqs.filter((req) => req.open && req.advanced === advanced && req.dueDay <= day);
}

/** An investor receipt while a due advance is still open. */
export function repayFirstBroken(advanceStillOpen: boolean, investorPaid: number): boolean {
  return advanceStillOpen && investorPaid > 0;
}

function rollMiss(req: ExitReq, day: number, rolled: number): void {
  req.misses += 1;
  req.lastMissDay = day;
  req.dueDay = rolled;
}

/** FIFO advances, then investors. Cash moves only after the advance is booked. */
export function settleQueue(world: World, platform: Platform, day: number): void {
  const advanced = due(platform.reqs, day, true);
  let blocked = false;
  const rolled = day + platform.windowDays;
  for (const req of advanced) {
    if (blocked || !req.line || platform.cash < req.nav) {
      blocked = true;
      rollMiss(req, day, rolled);
      continue;
    }
    platform.cash -= req.nav;
    settleAdvance(req);
    if (req.open) {
      platform.cash += req.nav;
      blocked = true;
      rollMiss(req, day, rolled);
    }
  }
  let paid = 0;
  const advanceOpen = advanced.some((req) => req.open);
  if (!advanceOpen) {
    for (const req of due(platform.reqs, day, false)) {
      if (platform.cash < req.nav) break;
      platform.cash -= req.nav;
      req.open = false;
      paid += req.nav;
    }
  }
  if (repayFirstBroken(advanceOpen, paid)) world.breaches += 1;
  world.investorPaid += paid;
}

export function processWindow(world: World, platform: Platform, day: number, scenario: Scenario, rng: Rng): void {
  let nav = 0;
  for (const req of platform.reqs) if (req.open && req.dueDay <= day) nav += req.nav;
  const factor = coverageFactor(scenario, platform, day, rng);
  let inject = scaleRepayment(Math.floor(nav * factor), scenario, day);
  if (platform.kind === "quarterly") {
    const cap = Math.floor((platform.book * 500) / 10_000);
    if (inject > cap) inject = cap;
  }
  platform.cash += inject;
  settleQueue(world, platform, day);
  platform.nextWindow = day + platform.windowDays;
}

export function enforceLates(world: World, day: number, scenario: Scenario): void {
  for (const platform of world.platforms) {
    const limit = missLimit(scenario, platform, day);
    for (const req of platform.reqs) {
      if (!req.open || !req.advanced || !req.line) continue;
      if (req.misses < limit || day < req.lastMissDay + GRACE_DAYS) continue;
      absorbLoss(req.line, world.facility, platform.id, req.principal, req.nav);
      req.open = false;
      platform.dead = true;
    }
  }
}
