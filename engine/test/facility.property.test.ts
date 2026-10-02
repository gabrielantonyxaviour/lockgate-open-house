import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { assessFacility } from "../src/facility/assess.js";
import { accrue, drawable, onRepay, solvent, type FacilityBooks } from "../src/facility/math.js";

const money = fc.bigInt({ min: 0n, max: 1_000_000_000_000n });

function books(parts: {
  senior: bigint;
  junior: bigint;
  drawn: bigint;
  interestCash: bigint;
  residual: bigint;
  locked: bigint;
  due: bigint;
}): FacilityBooks {
  const cash = parts.senior + parts.junior - parts.drawn + parts.interestCash + parts.residual + parts.locked;
  return {
    cash,
    drawn: parts.drawn,
    seniorPrincipal: parts.senior,
    juniorPrincipal: parts.junior,
    seniorDeficit: 0n,
    juniorDeficit: 0n,
    seniorInterestDue: parts.due,
    juniorInterestDue: 0n,
    seniorInterestCash: parts.interestCash,
    juniorInterestCash: 0n,
    residual: parts.residual,
    locked: parts.locked,
    seniorAprBps: 800n,
    juniorAprBps: 1_200n,
    lastAccrual: 1_700_000_000,
    recovery: false,
  };
}

describe("facility invariants", () => {
  it("keeps the books solvent and spends a repayment exactly once", () => {
    fc.assert(fc.property(
      money,
      money,
      money,
      money,
      money,
      money,
      (senior, junior, interestCash, residual, locked, repay) => {
        const drawn = (senior + junior) / 2n;
        const state = books({ senior, junior, drawn, interestCash, residual, locked, due: repay / 5n });
        expect(solvent(state)).toBe(true);
        const paid = onRepay(state, repay);
        const split = paid.split;
        const spent = split.seniorInterest + split.seniorPrincipalPay + split.seniorRestore
          + split.juniorInterest + split.juniorPrincipalPay + split.juniorRestore + split.residualAdd;
        expect(spent).toBe(repay);
        expect(solvent(paid.state)).toBe(true);
        expect(paid.state.cash).toBe(state.cash + repay);
      },
    ), { numRuns: 80 });
  });

  it("does not move principal when interest accrues, and caps the draw", () => {
    let openDraws = 0;
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 90 }),
      money,
      money,
      (days, eligible, drawnCap) => {
        const senior = 500_000_000n;
        const junior = 500_000_000n;
        const drawn = drawnCap % (senior + junior);
        const state = books({ senior, junior, drawn, interestCash: 0n, residual: 0n, locked: 0n, due: 0n });
        const next = accrue(state, state.lastAccrual + days * 86_400);
        expect(next.seniorPrincipal).toBe(state.seniorPrincipal);
        expect(next.cash + next.drawn).toBe(state.cash + state.drawn);
        const view = assessFacility({
          now: next.lastAccrual,
          cash: state.cash,
          drawn,
          seniorPrincipal: senior,
          juniorPrincipal: junior,
          seniorAprBps: 800,
          juniorAprBps: 1_200,
          advanceRateBps: 8_000,
          maxLateBps: 10_000,
          minJuniorBps: 0,
          lastAccrual: state.lastAccrual,
          recovery: false,
          eligibleOutstanding: eligible,
          lateOutstanding: 0n,
          bookReadable: true,
        });
        if (!view.breached) {
          const base = view.borrowingBase;
          const room = drawn >= base ? 0n : base - drawn;
          const liquid = drawable(view.books);
          const expected = room < liquid ? room : liquid;
          expect(view.availableDraw).toBe(expected);
          if (expected > 0n) openDraws += 1;
        } else {
          expect(view.availableDraw).toBe(0n);
        }
      },
    ), { numRuns: 60 });
    expect(openDraws).toBeGreaterThan(0);
  });
});
