import assert from "node:assert/strict";
import { test } from "node:test";
import { absorbLoss, depositEquity, draw, emptyLine, equityValue, postReserve, repay, residual, withdrawEquity, withdrawable, type Facility } from "../src/books.js";

function facility(juniorCash: number, juniorDrawn: number): Facility {
  return {
    seniorCash: 0, juniorCash, seniorDrawn: 0, juniorDrawn,
    seniorDeposited: 0, juniorDeposited: juniorCash + juniorDrawn,
    seniorInterest: 0, juniorInterest: 0, interestPaid: 0,
    seniorLoss: 0, juniorLoss: 0, seniorAprBps: 800, juniorAprBps: 1500,
    advanceRateBps: 8000, covenantBps: 5000,
  };
}

test("identity holds across deposit, reserve, draw, repay and a capped withdraw", () => {
  const line = emptyLine();
  depositEquity(line, 1_000_000);
  postReserve(line, "p", 100_000);
  draw(line, "p", 400_000);
  assert.equal(residual(line), 0);
  assert.ok(line.balance >= line.reserve);
  repay(line, "p", 400_000, 8_000);
  assert.equal(line.realizedFees, 8_000);
  assert.equal(residual(line), 0);
  const idle = withdrawable(line);
  withdrawEquity(line, idle);
  assert.equal(residual(line), 0);
  assert.equal(line.balance, line.reserve);
});

test("one platform reserve does not cover another platform", () => {
  const line = emptyLine();
  depositEquity(line, 1_000_000);
  postReserve(line, "a", 50_000);
  postReserve(line, "b", 80_000);
  draw(line, "a", 200_000);
  const split = absorbLoss(line, null, "a", 200_000);
  assert.equal(split.reserve, 50_000);
  assert.equal(line.reserves.b, 80_000);
  assert.equal(split.equity, 150_000);
  assert.equal(residual(line), 0);
});

test("junior absorbs before equity and equity before senior", () => {
  const line = emptyLine();
  depositEquity(line, 100_000);
  postReserve(line, "p", 10_000);
  line.balance += 200_000;
  line.juniorDebt = 50_000;
  line.seniorDebt = 150_000;
  const pot = facility(20_000, 50_000);
  pot.seniorDrawn = 150_000;
  draw(line, "p", 180_000);
  assert.equal(residual(line), 0);
  const split = absorbLoss(line, pot, "p", 180_000);
  assert.equal(split.reserve, 10_000);
  assert.equal(split.juniorCash, 20_000);
  assert.equal(split.juniorDebt, 50_000);
  assert.equal(split.equity, 100_000);
  assert.equal(split.senior, 0);
  assert.equal(pot.seniorLoss, 0);
  assert.equal(line.seniorDebt, 150_000);
  assert.equal(line.juniorDebt, 0);
  assert.equal(residual(line), 0);
  assert.ok(equityValue(line) >= 0);
});

test("senior is written down only after junior and equity are exhausted", () => {
  const line = emptyLine();
  depositEquity(line, 30_000);
  line.balance += 100_000;
  line.juniorDebt = 20_000;
  line.seniorDebt = 80_000;
  const pot = facility(0, 20_000);
  pot.seniorDrawn = 80_000;
  draw(line, "p", 100_000);
  const split = absorbLoss(line, pot, "p", 100_000);
  assert.equal(split.juniorDebt, 20_000);
  assert.equal(split.equity, 30_000);
  assert.equal(split.senior, 50_000);
  assert.equal(pot.seniorLoss, 50_000);
  assert.equal(line.juniorDebt, 0);
  assert.equal(residual(line), 0);
});
