import { describe, expect, it } from "vitest";
import { assessFacility } from "../src/facility/assess.js";
import { applyLoss, enterRecovery, mulDivFloor, onRepay, type FacilityBooks } from "../src/facility/math.js";
import { SECONDS_PER_YEAR } from "../src/money.js";
import { EngineError } from "../src/errors.js";

const now = 1_700_000_000;

function row(patch: Record<string, unknown> = {}) {
  return {
    now,
    cash: 900_000n,
    drawn: 100_000n,
    seniorPrincipal: 500_000n,
    juniorPrincipal: 500_000n,
    seniorAprBps: 800,
    juniorAprBps: 1_200,
    advanceRateBps: 8_000,
    maxLateBps: 2_000,
    minJuniorBps: 2_000,
    lastAccrual: now,
    recovery: false,
    eligibleOutstanding: 1_000_000n,
    lateOutstanding: 0n,
    bookReadable: true,
    ...patch,
  };
}

describe("facility", () => {
  it("sizes the draw as the tighter of borrowing base and idle cash", () => {
    const view = assessFacility(row());
    expect(view.solvent).toBe(true);
    expect(view.borrowingBase).toBe(800_000n);
    expect(view.drawable).toBe(900_000n);
    expect(view.availableDraw).toBe(700_000n);
    expect(view.breached).toBe(false);
    expect(assessFacility(row({ payout: 700_000n })).canFund).toBe(true);
    expect(assessFacility(row({ payout: 700_001n })).canFund).toBe(false);
  });

  it("stops draws on a late book, a thin junior, an unread book, recovery, and a depeg", () => {
    expect(assessFacility(row({
      eligibleOutstanding: 700_000n,
      lateOutstanding: 300_000n,
    })).reasons).toContain("late-ratio");
    expect(assessFacility(row({
      seniorPrincipal: 900_000n,
      juniorPrincipal: 100_000n,
      cash: 900_000n,
    })).reasons).toContain("junior-thin");
    const unread = assessFacility(row({ bookReadable: false, drawn: 1n, cash: 999_999n }));
    expect(unread.reasons).toEqual(["book-unreadable"]);
    expect(unread.availableDraw).toBe(0n);
    expect(assessFacility(row({ recovery: true })).availableDraw).toBe(0n);
    const peg = assessFacility(row({
      peg: { enabled: true, priceE8: 99_000_000n, updatedAt: now, minPriceE8: 100_000_000n, maxOracleAge: 60 },
    }));
    expect(peg.reasons).toContain("peg");
    expect(peg.availableDraw).toBe(0n);
    const off = assessFacility(row({
      peg: { enabled: false, priceE8: 1n, updatedAt: 0, minPriceE8: 100_000_000n, maxOracleAge: 0 },
    }));
    expect(off.breached).toBe(false);
  });

  it("floors interest and pays senior before junior", () => {
    const accrued = assessFacility(row({
      now: now + 2_592_000,
      lastAccrual: now,
      cash: 0n,
      drawn: 1_000_000n,
      seniorPrincipal: 1_000_000n,
      juniorPrincipal: 0n,
      seniorAprBps: 1_200,
      minJuniorBps: 0,
      advanceRateBps: 10_000,
      eligibleOutstanding: 1_000_000n,
    }));
    const perYear = mulDivFloor(1_000_000n, 1_200n, 10_000n);
    expect(accrued.books.seniorInterestDue).toBe(mulDivFloor(perYear, 2_592_000n, SECONDS_PER_YEAR));
    expect(accrued.books.seniorInterestDue).toBe(9_863n);
    const books: FacilityBooks = {
      ...accrued.books,
      seniorInterestDue: 10n,
      drawn: 40n,
      seniorPrincipal: 100n,
      cash: 60n,
      juniorPrincipal: 0n,
    };
    const paid = onRepay(books, 25n);
    expect(paid.split.seniorInterest + paid.split.seniorPrincipalPay + paid.split.residualAdd).toBe(25n);
    expect(paid.split.seniorInterest).toBe(10n);
    expect(paid.split.juniorPrincipalPay).toBe(0n);
    expect(paid.state.drawn).toBe(25n);
  });

  it("takes a loss from junior first and refuses a book that is already overdrawn", () => {
    const books: FacilityBooks = {
      cash: 60n,
      drawn: 80n,
      seniorPrincipal: 100n,
      juniorPrincipal: 40n,
      seniorDeficit: 0n,
      juniorDeficit: 0n,
      seniorInterestDue: 0n,
      juniorInterestDue: 5n,
      seniorInterestCash: 0n,
      juniorInterestCash: 0n,
      residual: 0n,
      locked: 0n,
      seniorAprBps: 0n,
      juniorAprBps: 0n,
      lastAccrual: now,
      recovery: false,
    };
    const loss = applyLoss(books, 50n);
    expect(loss.applied).toBe(50n);
    expect(loss.state.juniorPrincipal).toBe(0n);
    expect(loss.state.seniorPrincipal).toBe(90n);
    expect(loss.state.drawn).toBe(30n);
    const recovered = enterRecovery(books);
    expect(recovered.recovery).toBe(true);
    expect(recovered.juniorInterestDue).toBe(0n);
    expect(() => assessFacility(row({ drawn: 10n, seniorPrincipal: 3n, juniorPrincipal: 3n, cash: 0n }))).toThrow(EngineError);
  });
});
