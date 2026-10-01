import assert from "node:assert/strict";
import { test } from "node:test";
import {
  absorbLoss,
  assertLine,
  canDraw,
  depositEquity,
  draw,
  emptyLine,
  postReserve,
  repay,
  residual,
  withdrawEquity,
  withdrawable,
} from "../src/books.js";
import { fail } from "../src/errors.js";
import { MAX_FEE_BPS, MAX_NAV_AGE_SECONDS, MIN_FEE_BPS } from "../src/params.js";
import { feeFromBps, quoteFee, type QuoteInput } from "../src/pricing.js";

const flat: Omit<QuoteInput, "secondsToWindow"> = {
  navAgeSeconds: 0,
  gated: false,
  exposureBps: 0,
  utilizationBps: 0,
  riskBps: 10_000,
  timeScale: 1,
};

test("refusals name the reason and do not clamp into a price", () => {
  assert.equal(quoteFee({ ...flat, secondsToWindow: 86_400, exposureBps: 10_001 }).reason, "bps-range");
  assert.equal(quoteFee({ ...flat, secondsToWindow: 86_400, utilizationBps: 10_001 }).reason, "bps-range");
  assert.equal(quoteFee({ ...flat, secondsToWindow: 366 * 86_400 + 1 }).reason, "tenor");
  assert.equal(quoteFee({ ...flat, secondsToWindow: 86_400, timeScale: 10_001 }).reason, "tenor");
  assert.equal(quoteFee({ ...flat, secondsToWindow: 86_400, riskBps: 50_001 }).reason, "risk");
  const atCap = quoteFee({ ...flat, secondsToWindow: 86_400, navAgeSeconds: MAX_NAV_AGE_SECONDS });
  assert.equal(atCap.available, true);
  const past = quoteFee({ ...flat, secondsToWindow: 86_400, navAgeSeconds: MAX_NAV_AGE_SECONDS + 1 });
  assert.deepEqual(past, { available: false, bps: 0, reason: "stale-nav" });
});

test("a seeded sweep keeps every available fee inside the band", () => {
  let seed = 20261002;
  const next = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 400; i++) {
    const quote = quoteFee({
      secondsToWindow: next() % (400 * 86_400),
      navAgeSeconds: next() % (30 * 86_400),
      gated: next() % 7 === 0,
      exposureBps: next() % 12_000,
      utilizationBps: next() % 12_000,
      riskBps: next() % 60_000,
      timeScale: next() % 12_000,
    });
    if (!quote.available) {
      assert.equal(quote.bps, 0);
      assert.ok(["gated", "stale-nav", "bps-range", "tenor", "risk"].includes(quote.reason));
      continue;
    }
    assert.ok(quote.bps >= MIN_FEE_BPS && quote.bps <= MAX_FEE_BPS);
    const fee = feeFromBps(10_000_000, quote.bps);
    assert.ok(fee > 0 && fee < 10_000_000);
  }
});

test("canDraw names dust, limit, reserve and capital", () => {
  const line = emptyLine();
  depositEquity(line, 1_000);
  postReserve(line, "p", 10);
  assert.deepEqual(canDraw(line, "p", 0, 500, 10_000), { ok: false, reason: "dust" });
  assert.deepEqual(canDraw(line, "p", 200, 500, 100), { ok: false, reason: "over-limit" });
  assert.deepEqual(canDraw(line, "p", 500, 1_000, 10_000), { ok: false, reason: "reserve-short" });
  assert.deepEqual(canDraw(line, "p", 1_001, 0, 10_000), { ok: false, reason: "capital-short" });
  assert.deepEqual(canDraw(line, "p", 100, 500, 10_000), { ok: true });
});

test("draws and repayments that break the book throw a coded error", () => {
  const line = emptyLine();
  depositEquity(line, 100);
  postReserve(line, "p", 80);
  assert.throws(() => draw(line, "p", 101), (err: unknown) => coded(err, "solvency"));
  assert.equal(line.principal, 0);
  draw(line, "p", 10);
  assert.throws(() => repay(line, "p", 11, 1), (err: unknown) => coded(err, "repay"));
  assert.throws(() => withdrawEquity(line, withdrawable(line) + 1), (err: unknown) => coded(err, "withdraw"));
  assert.equal(residual(line), 0);
});

test("senior is exhausted before any overflow, and overflow does not move the residual", () => {
  const line = emptyLine();
  depositEquity(line, 10);
  line.balance += 20;
  line.seniorDebt = 20;
  draw(line, "p", 30);
  const split = absorbLoss(line, null, "p", 30);
  assert.equal(split.equity, 10);
  assert.equal(split.senior, 20);
  assert.equal(line.seniorDebt, 0);
  assert.equal(residual(line), 0);
  assertLine(line);

  const broken = emptyLine();
  broken.principal = 100;
  broken.exposure.p = 100;
  broken.equity = 10;
  broken.seniorDebt = 20;
  const before = residual(broken);
  const over = absorbLoss(broken, null, "p", 100);
  assert.equal(over.equity, 80);
  assert.equal(over.senior, 20);
  assert.equal(broken.seniorDebt, 0);
  assert.equal(residual(broken), before);
});

test("fail carries the api payload and nothing else", () => {
  assert.throws(
    () => fail("withdraw exceeds idle equity", "withdraw"),
    (err: unknown) => coded(err, "withdraw") && (err as { message: string }).message === "withdraw exceeds idle equity",
  );
  try {
    fail("identity residual 1");
  } catch (err) {
    const payload = (err as { payload: { error: string; code?: string } }).payload;
    assert.deepEqual(payload, { error: "identity residual 1" });
    assert.equal("code" in payload, false);
  }
});

function coded(err: unknown, code: string): boolean {
  const payload = (err as { payload?: { error?: string; code?: string } }).payload;
  return payload?.code === code && typeof payload.error === "string";
}
