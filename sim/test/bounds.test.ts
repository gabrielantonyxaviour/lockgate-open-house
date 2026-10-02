import assert from "node:assert/strict";
import { test } from "node:test";
import { depositEquity, draw, emptyLine, residual, type Facility, type Line } from "../src/books.js";
import { fundExit } from "../src/fund.js";
import { GRACE_DAYS, JUNIOR_COVENANT_BPS, SENIOR_APR_BPS, u } from "../src/params.js";
import type { Rng } from "../src/rng.js";
import { scenarioSet } from "../src/scenarios.js";
import { enforceLates, missLimit, processWindow } from "../src/window.js";
import { accrueAndPay, buildWorld, covenantBroken, pullFacility, type ExitReq, type Platform, type World } from "../src/world.js";

const SEED = 20261001;
const steady: Rng = { next: () => 1, int: () => 0, bool: () => false };

function shell(platform: Platform, line: Line | null, facility: Facility | null, stage: World["stage"]): World {
  return {
    stage,
    platforms: [platform],
    lines: line ? [line] : [],
    vaults: [],
    facility,
    cursor: 0,
    techFee: 0,
    breaches: 0,
    requested: 0,
    advanced: 0,
    investorPaid: 0,
    rejected: {},
    lockgateSwept: 0,
  };
}

function openAdvance(line: Line, misses: number): { platform: Platform; req: ExitReq } {
  draw(line, "p05", 99_000, 100_000);
  const req: ExitReq = {
    nav: 100_000, fee: 1_000, principal: 99_000, advanced: true, dueDay: 1, open: true,
    line, platform: "p05", feeBps: 100, misses, lastMissDay: 10,
  };
  const platform: Platform = {
    id: "p05", kind: "weekly", windowDays: 7, nextWindow: 1, reserveBps: 500,
    limit: u(150_000), book: u(800_000), cash: 0, reserveBudget: 0, navAgeDays: 0,
    refreshPhase: 0, riskBps: 8_000, gateInRun: false, dead: false, reqs: [req],
  };
  return { platform, req };
}

test("a write-off waits for the miss limit and the grace day, then the platform is defaulted", () => {
  assert.equal(GRACE_DAYS, 2);
  const scenario = scenarioSet(60)[0];
  assert.ok(scenario);
  assert.equal(scenario.name, "baseline");

  const early = emptyLine();
  depositEquity(early, 200_000);
  const held = openAdvance(early, 8);
  assert.equal(missLimit(scenario, held.platform), 8);
  const waiting = shell(held.platform, early, null, "stage1");
  enforceLates(waiting, held.req.lastMissDay + GRACE_DAYS - 1, scenario);
  assert.equal(held.req.open, true);
  assert.equal(held.platform.dead, false);
  assert.equal(early.creditLossEquity, 0);
  assert.equal(residual(early), 0);

  const short = emptyLine();
  depositEquity(short, 200_000);
  const few = openAdvance(short, 7);
  enforceLates(shell(few.platform, short, null, "stage1"), few.req.lastMissDay + GRACE_DAYS, scenario);
  assert.equal(few.req.open, true);
  assert.equal(few.platform.dead, false);
  assert.equal(short.creditLossEquity, 0);

  const line = emptyLine();
  depositEquity(line, 200_000);
  const due = openAdvance(line, 8);
  const world = shell(due.platform, line, null, "stage1");
  enforceLates(world, due.req.lastMissDay + GRACE_DAYS, scenario);
  assert.equal(due.req.open, false);
  assert.equal(due.platform.dead, true);
  assert.equal(line.creditLossEquity, 99_000);
  assert.equal(line.principal, 0);
  assert.equal(residual(line), 0);

  fundExit(world, due.platform, u(1_000), 12, 19, false);
  assert.deepEqual(world.rejected, { defaulted: 1 });
  assert.equal(world.advanced, 0);
  assert.equal(due.platform.reqs.length, 1);
});

test("junior loss equal to half the deposit still draws, and one unit over is covenant", () => {
  assert.equal(JUNIOR_COVENANT_BPS, 5_000);
  const line = emptyLine();
  line.equity = 100;
  line.principal = 100;
  const facility: Facility = {
    seniorCash: 60, juniorCash: 40, seniorDrawn: 0, juniorDrawn: 0,
    seniorDeposited: 60, juniorDeposited: 40,
    seniorInterest: 0, juniorInterest: 0, interestPaid: 0,
    seniorLoss: 0, juniorLoss: 20, seniorAprBps: 800, juniorAprBps: 1_500,
    advanceRateBps: 8_000, covenantBps: 5_000,
  };
  assert.equal(covenantBroken(facility), false);
  pullFacility(line, facility);
  assert.equal(line.balance, 80);
  assert.equal(line.seniorDebt, 48);
  assert.equal(line.juniorDebt, 32);
  assert.equal(facility.seniorCash, 12);
  assert.equal(facility.juniorCash, 8);
  assert.equal(residual(line), 0);

  const stopped = emptyLine();
  stopped.equity = 100;
  stopped.principal = 100;
  facility.juniorLoss = 21;
  const cash = facility.seniorCash;
  pullFacility(stopped, facility);
  assert.equal(covenantBroken(facility), true);
  assert.equal(stopped.balance, 0);
  assert.equal(stopped.seniorDebt, 0);
  assert.equal(facility.seniorCash, cash);

  const dust = emptyLine();
  dust.equity = 1;
  dust.principal = 1;
  const penny: Facility = {
    ...facility,
    seniorCash: 1, juniorCash: 1, seniorDrawn: 0, juniorDrawn: 0,
    seniorDeposited: 1, juniorDeposited: 2, juniorLoss: 0, advanceRateBps: 10_000,
  };
  assert.equal(covenantBroken(penny), false);
  pullFacility(dust, penny);
  assert.equal(dust.seniorDebt, 0);
  assert.equal(dust.juniorDebt, 1);
  assert.equal(penny.seniorCash, 1);
  assert.equal(penny.juniorCash, 0);
  assert.equal(residual(dust), 0);

  const broken = buildWorld("stage3", SEED);
  const pot = broken.facility;
  const book = broken.lines[0];
  const platform = broken.platforms[0];
  assert.ok(pot && book && platform);
  const half = Number((BigInt(pot.juniorDeposited) * BigInt(pot.covenantBps)) / 10_000n);
  assert.equal(half, u(200_000));
  pot.juniorLoss = half;
  platform.navAgeDays = 0;
  fundExit(broken, platform, u(1_000), 1, 8, false);
  assert.equal(broken.rejected.covenant, undefined);
  assert.equal(broken.advanced, 1);

  const next = buildWorld("stage3", SEED);
  const nextPot = next.facility;
  const nextPlatform = next.platforms[0];
  assert.ok(nextPot && nextPlatform);
  nextPot.juniorLoss = half + 1;
  nextPlatform.navAgeDays = 0;
  fundExit(next, nextPlatform, u(1_000), 1, 8, false);
  assert.deepEqual(next.rejected, { covenant: 1 });
  assert.equal(next.advanced, 0);
  assert.equal(nextPlatform.reqs.length, 0);
});

test("stage-3 interest is a daily floor, and a year of floors is short of the one-shot year", () => {
  assert.equal(SENIOR_APR_BPS, 800);
  const debt = 40_000_000_000;
  const oneShot = Number((BigInt(debt) * 800n) / 10_000n);
  const daily = Number((BigInt(debt) * 800n) / 10_000n / 365n);
  assert.equal(oneShot, 3_200_000_000);
  assert.equal(daily, 8_767_123);

  const unpaid = emptyLine();
  unpaid.seniorDebt = debt;
  const owed: Facility = {
    seniorCash: 0, juniorCash: 0, seniorDrawn: debt, juniorDrawn: 0,
    seniorDeposited: debt, juniorDeposited: 0,
    seniorInterest: 0, juniorInterest: 0, interestPaid: 0,
    seniorLoss: 0, juniorLoss: 0, seniorAprBps: 800, juniorAprBps: 1_500,
    advanceRateBps: 8_000, covenantBps: 5_000,
  };
  accrueAndPay(unpaid, owed);
  assert.equal(unpaid.balance, 0);
  assert.equal(unpaid.interestExpense, 0);
  assert.equal(owed.seniorInterest, daily);
  assert.equal(owed.juniorInterest, 0);

  const line = emptyLine();
  depositEquity(line, daily * 365);
  line.balance += debt;
  line.seniorDebt = debt;
  assert.equal(residual(line), 0);
  const facility: Facility = { ...owed, seniorInterest: 0 };
  for (let day = 0; day < 365; day += 1) accrueAndPay(line, facility);
  assert.equal(line.interestExpense, daily * 365);
  assert.equal(line.interestExpense, 3_199_999_895);
  assert.equal(oneShot - line.interestExpense, 105);
  assert.equal(facility.seniorInterest, 0);
  assert.equal(facility.interestPaid, line.interestExpense);
  assert.equal(facility.juniorInterest, 0);
  assert.equal(line.balance, debt);
  assert.equal(residual(line), 0);
});

test("a quarterly window injects at most 5 percent of the book", () => {
  const scenario = scenarioSet(60)[0];
  assert.ok(scenario);
  const cap = Math.floor((u(800_000) * 500) / 10_000);
  assert.equal(cap, u(40_000));

  function window(kind: Platform["kind"], nav: number): Platform {
    const platform: Platform = {
      id: "p30", kind, windowDays: kind === "quarterly" ? 90 : 7, nextWindow: 1,
      reserveBps: 500, limit: u(150_000), book: u(800_000), cash: 0, reserveBudget: 0,
      navAgeDays: 0, refreshPhase: 0, riskBps: 8_000, gateInRun: false, dead: false, reqs: [],
    };
    platform.reqs.push({
      nav, fee: 0, principal: 0, advanced: true, dueDay: 1, open: true,
      line: null, platform: platform.id, feeBps: 25, misses: 0, lastMissDay: -1,
    });
    processWindow(shell(platform, null, null, "stage1"), platform, 1, scenario, steady);
    return platform;
  }

  const capped = window("quarterly", u(100_000));
  assert.equal(capped.cash, cap);
  assert.equal(capped.reqs[0]!.open, true);
  assert.equal(capped.nextWindow, 91);

  const exact = window("quarterly", cap);
  assert.equal(exact.cash, cap);

  const weekly = window("weekly", u(100_000));
  assert.equal(weekly.cash, u(100_000));
  assert.equal(weekly.nextWindow, 8);
});

test("stage 2 funds only a vault whose mandate lists the platform", () => {
  const world = buildWorld("stage2", SEED);
  const platform = world.platforms[30];
  assert.ok(platform);
  assert.equal(platform.kind, "quarterly");
  assert.equal(platform.id, "p30");
  fundExit(world, platform, u(1_000), 1, 2, false);
  assert.equal(world.advanced, 1);
  assert.deepEqual(world.rejected, {});
  assert.equal(world.vaults[0]!.line.principal, 0);
  assert.equal(world.vaults[1]!.line.principal, 0);
  assert.ok(world.vaults[2]!.line.principal > 0);
  assert.equal(world.vaults[2]!.id, "Marina");
  assert.equal(world.cursor, 2);
  assert.equal(world.lockgateSwept, 0);

  const refused = buildWorld("stage2", SEED);
  const stranger = refused.platforms[30];
  assert.ok(stranger);
  for (const vault of refused.vaults) vault.mandate.platforms.delete(stranger.id);
  const balances = refused.vaults.map((vault) => vault.line.balance);
  fundExit(refused, stranger, u(1_000), 1, 2, false);
  assert.equal(refused.advanced, 0);
  assert.deepEqual(refused.rejected, { "mandate-platform": 1 });
  assert.deepEqual(refused.vaults.map((vault) => vault.line.balance), balances);
  assert.ok(refused.vaults.every((vault) => vault.line.principal === 0));
});
