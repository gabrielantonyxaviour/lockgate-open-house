import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { mulDivRoundHalfUp } from "../src/money.js";
import { DEFAULT_PARAMS, RISK_WEIGHTS } from "../src/pricing/defaults.js";
import { quoteExit } from "../src/quote.js";
import { monthEpoch } from "../src/examples.js";

describe("pricing properties", () => {
  it("keeps risk weights at 10000", () => {
    const sum = Object.values(RISK_WEIGHTS).reduce((total, weight) => total + weight, 0);
    expect(sum).toBe(10_000);
  });

  it("holds the fee inside the protocol band and conserves nav", () => {
    const now = 1_700_000_000;
    let priced = 0;
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 10_000 }),
      fc.integer({ min: 2, max: 200 }),
      fc.bigInt({ min: 1_000_000n, max: 50_000_000_000n }),
      (utilizationBps, days, navValue) => {
        const quote = quoteExit({
          ...monthEpoch(now),
          utilizationBps,
          epochSeconds: days * 86_400,
          navValue,
          limit: navValue * 10n,
          reserveBalance: navValue,
          bookAssets: navValue * 20n,
        }, DEFAULT_PARAMS);
        expect(quote.available).toBe(true);
        priced += 1;
        expect(quote.risk.bps).toBeGreaterThanOrEqual(0);
        expect(quote.risk.bps).toBeLessThanOrEqual(10_000);
        expect(quote.payout + quote.fee).toBe(navValue);
        expect(quote.fee).toBe(mulDivRoundHalfUp(navValue, BigInt(quote.feeBps), 10_000n));
        expect(quote.feeBps).toBeGreaterThanOrEqual(DEFAULT_PARAMS.minFeeBps);
        expect(quote.feeBps).toBeLessThanOrEqual(DEFAULT_PARAMS.maxFeeBps);
      },
    ), { numRuns: 200 });
    expect(priced).toBe(200);
  });

  it("does not cut the fee when the wait or the utilization rises", () => {
    const now = 1_700_000_000;
    let compared = 0;
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 9_000 }),
      fc.integer({ min: 10, max: 80 }),
      fc.integer({ min: 1, max: 40 }),
      (utilizationBps, days, extra) => {
        const shorter = quoteExit({
          ...monthEpoch(now),
          utilizationBps,
          epochSeconds: days * 86_400,
        }, DEFAULT_PARAMS);
        const longer = quoteExit({
          ...monthEpoch(now),
          utilizationBps,
          epochSeconds: (days + extra) * 86_400,
        }, DEFAULT_PARAMS);
        const busier = quoteExit({
          ...monthEpoch(now),
          utilizationBps: Math.min(10_000, utilizationBps + 500),
          epochSeconds: days * 86_400,
        }, DEFAULT_PARAMS);
        expect(shorter.available && longer.available && busier.available).toBe(true);
        compared += 1;
        expect(longer.feeBps).toBeGreaterThanOrEqual(shorter.feeBps);
        expect(longer.riskFeeBps).toBeGreaterThanOrEqual(shorter.riskFeeBps);
        expect(busier.feeBps).toBeGreaterThanOrEqual(shorter.feeBps);
        expect(busier.riskFeeBps).toBeGreaterThanOrEqual(shorter.riskFeeBps);
      },
    ), { numRuns: 120 });
    expect(compared).toBe(120);
  });
});
