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
} from "./books.js";
import { mandateAssets, mandateReject, type Mandate } from "./mandate.js";
import { repayFirstBroken, settleQueue } from "./window.js";
import { buildWorld, type ExitReq } from "./world.js";

export type Regression = {
  id: string;
  name: string;
  /** `fixed` pins the corrected behavior. `open` pins a break that is still reproduced. */
  kind: "fixed" | "open";
  repro: () => void;
};

const mandate = (concentrationBps: number): Mandate => ({
  platforms: new Set(["p"]),
  limit: 100_000,
  minFeeBps: 25,
  maxTenorSeconds: 86_400,
  concentrationBps,
  expiryDay: 10,
  paused: false,
});

/** T-1. Caps use owed nav. Reserve rounds up. The concentration cap floors. */
function owedNavAndReserveCeil(): void {
  const line = emptyLine();
  depositEquity(line, 20_000);
  assert.equal(reserveNeed(10_001, 1), 2);
  assert.equal(Math.floor((10_001 * 1) / 10_000), 1);
  postReserve(line, "p", 1);
  assert.deepEqual(canDraw(line, "p", 10_001, 10_001, 1, 100_000), { ok: false, reason: "reserve-short" });
  assert.deepEqual(canDraw(line, "p", 90, 110, 0, 100), { ok: false, reason: "over-limit" });
  assert.deepEqual(canDraw(line, "p", 90, 100, 0, 100), { ok: true });

  const book = emptyLine();
  depositEquity(book, 10_001);
  const input = { platform: "p", day: 1, feeBps: 100, tenorSeconds: 600, principal: 900 };
  const cap = Math.floor((10_001 * 1_000) / 10_000);
  assert.equal(cap, 1_000);
  assert.equal(mandateReject(book, mandate(1_000), { ...input, owed: cap }), null);
  assert.equal(mandateReject(book, mandate(1_000), { ...input, owed: cap + 1 }), "mandate-concentration");
}

/** T-2. Interest already paid is not equity that can absorb a later loss. */
function interestIsNotEquity(): void {
  const line = emptyLine();
  depositEquity(line, 100_000);
  line.balance += 50_000;
  line.seniorDebt = 50_000;
  line.interestExpense = 40_000;
  line.balance -= 40_000;
  draw(line, "p", 110_000);
  const pot: Facility = {
    seniorCash: 0, juniorCash: 0, seniorDrawn: 50_000, juniorDrawn: 0,
    seniorDeposited: 0, juniorDeposited: 0, seniorInterest: 0, juniorInterest: 0,
    interestPaid: 0, seniorLoss: 0, juniorLoss: 0, seniorAprBps: 800, juniorAprBps: 1_500,
    advanceRateBps: 8_000, covenantBps: 5_000,
  };
  const split = absorbLoss(line, pot, "p", 110_000);
  assert.equal(split.equity, 60_000);
  assert.equal(split.senior, 50_000);
  assert.equal(pot.seniorLoss, 50_000);
  assert.equal(residual(line), 0);
}

function booked(nav: number, fee: number, line: ExitReq["line"], platform: string): ExitReq {
  return {
    nav, fee, principal: nav - fee, advanced: true, dueDay: 1, open: true,
    line, platform, feeBps: 100, misses: 0, lastMissDay: -1,
  };
}

/** T-3. An open advance is repaid before any investor, and an unbooked advance spends nothing. */
function repayFirst(): void {
  const world = buildWorld("stage1", 7);
  const platform = world.platforms[0]!;
  platform.reqs.push(
    booked(100, 1, null, platform.id),
    {
      nav: 50, fee: 0, principal: 0, advanced: false, dueDay: 1, open: true,
      line: null, platform: platform.id, feeBps: 0, misses: 0, lastMissDay: -1,
    },
  );
  platform.cash = 1_000;
  settleQueue(world, platform, 1);
  assert.equal(platform.cash, 1_000);
  assert.equal(world.investorPaid, 0);
  assert.equal(world.breaches, 0);
  assert.equal(repayFirstBroken(true, 50), true);

  const short = buildWorld("stage1", 7);
  const line = short.lines[0]!;
  const holder = short.platforms[0]!;
  const first = booked(10_000, 100, line, holder.id);
  const second = booked(8_000, 80, line, holder.id);
  draw(line, holder.id, first.principal, first.nav);
  draw(line, holder.id, second.principal, second.nav);
  holder.reqs.push(first, second, {
    nav: 5_000, fee: 0, principal: 0, advanced: false, dueDay: 1, open: true,
    line: null, platform: holder.id, feeBps: 0, misses: 0, lastMissDay: -1,
  });
  holder.cash = 10_000;
  settleQueue(short, holder, 1);
  assert.equal(holder.reqs[0]!.open, false);
  assert.equal(holder.reqs[1]!.open, true);
  assert.equal(holder.reqs[2]!.open, true);
  assert.equal(short.investorPaid, 0);
  assert.equal(short.breaches, 0);
}

/** T-8. Posted reserve is outside the concentration base. */
function reserveOutsideConcentration(): void {
  const line = emptyLine();
  depositEquity(line, 9_000);
  postReserve(line, "p", 1_000);
  assert.equal(line.balance + line.principal, 10_000);
  assert.equal(mandateAssets(line), 9_000);
  const input = { platform: "p", day: 1, feeBps: 100, tenorSeconds: 600, principal: 800 };
  assert.equal(mandateReject(line, mandate(1_000), { ...input, owed: 900 }), null);
  assert.equal(mandateReject(line, mandate(1_000), { ...input, owed: 901 }), "mandate-concentration");
}

/** Open. One relayRepay pays the vault at index 0 and leaves the other vault open. */
function frontRunRepay(): void {
  const report = frontRunRepayment();
  assert.equal(report.id, "front-run-repay");
  assert.equal(report.broke, true);
  assert.match(report.steps[2] ?? "", /pays 100000000 to grief/);
  assert.match(report.steps[3] ?? "", /empty/);
  assert.match(report.steps[4] ?? "", /honest/);
}

export const regressions: readonly Regression[] = [
  { id: "T-1", name: "owed-nav-and-reserve-ceil", kind: "fixed", repro: owedNavAndReserveCeil },
  { id: "T-2", name: "interest-is-not-equity", kind: "fixed", repro: interestIsNotEquity },
  { id: "T-3", name: "repay-first", kind: "fixed", repro: repayFirst },
  { id: "T-8", name: "reserve-outside-concentration", kind: "fixed", repro: reserveOutsideConcentration },
  { id: "front-run-repay", name: "one-index-leaves-the-other-vault-open", kind: "open", repro: frontRunRepay },
];
