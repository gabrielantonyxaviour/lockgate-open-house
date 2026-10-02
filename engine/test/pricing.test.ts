import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { utilizationAprBps } from "../src/pricing/curve.js";
import { SECONDS_PER_YEAR, mulDivCeil, mulDivRoundHalfUp } from "../src/money.js";
import { quoteExit } from "../src/quote.js";
import { demoTenMinutes, emptyHistory, monthEpoch, weeklyClear } from "../src/examples.js";
import { EngineError } from "../src/errors.js";

const U = 1_000_000n;
const DAY = 86_400;

describe("pricing", () => {
  it("locks the 12% thirty-day time component at 99 bps before risk", () => {
    const raw = Number(mulDivRoundHalfUp(1200n * 2_592_000n, 1n, SECONDS_PER_YEAR));
    expect(raw).toBe(99);
  });

  it("pins the utilization curve to the on-chain 12 / 12 / 18 bands", () => {
    expect(utilizationAprBps(0, DEFAULT_PARAMS)).toBe(1200);
    expect(utilizationAprBps(6667, DEFAULT_PARAMS)).toBe(1200);
    expect(utilizationAprBps(10_000, DEFAULT_PARAMS)).toBe(1800);
    expect(utilizationAprBps(3000, DEFAULT_PARAMS)).toBe(1200);
    expect(utilizationAprBps(9000, DEFAULT_PARAMS)).toBe(1620);
  });

  it("prices a 30-day epoch from the APR the quote itself reports", () => {
    const quote = quoteExit(monthEpoch(), DEFAULT_PARAMS);
    expect(quote.available).toBe(true);
    expect(quote.secondsToClear).toBe(30 * DAY);
    expect(quote.apr.utilization).toBe(1200);
    const raw = Number(mulDivRoundHalfUp(BigInt(quote.apr.total) * BigInt(quote.pricedSeconds), 1n, SECONDS_PER_YEAR));
    expect(quote.riskFeeBps).toBe(raw);
    expect(quote.feeBps).toBe(Math.min(1500, Math.max(25, raw)));
    expect(quote.payout + quote.fee).toBe(quote.navValue);
    expect(quote.fee).toBe(mulDivCeil(quote.navValue, BigInt(quote.feeBps), 10_000n));
  });

  it("treats a 10-minute demo window at time scale 4320 as a 30-day wait", () => {
    const demo = demoTenMinutes();
    const scaled = quoteExit(demo.input, demo.params);
    const real = quoteExit(monthEpoch(demo.input.now), DEFAULT_PARAMS);
    expect(scaled.secondsToClear).toBe(600);
    expect(scaled.pricedSeconds).toBe(real.pricedSeconds);
    expect(scaled.feeBps).toBe(real.feeBps);
  });

  it("charges more once the book is past the two-thirds kink", () => {
    const idle = quoteExit(monthEpoch(), DEFAULT_PARAMS);
    const kink = quoteExit({ ...monthEpoch(), utilizationBps: 6667 }, DEFAULT_PARAMS);
    const busy = quoteExit({ ...monthEpoch(), utilizationBps: 9000 }, DEFAULT_PARAMS);
    const full = quoteExit({ ...monthEpoch(), utilizationBps: 10_000 }, DEFAULT_PARAMS);
    expect(kink.feeBps).toBe(idle.feeBps);
    expect(busy.feeBps).toBeGreaterThan(idle.feeBps);
    expect(full.feeBps).toBeGreaterThanOrEqual(busy.feeBps);
    expect(busy.apr.utilization).toBe(1620);
  });

  it("floors a covered one-day wait at 25 bps", () => {
    const quote = quoteExit({ ...monthEpoch(), epochSeconds: 2 * DAY, cutoffSeconds: 3_600 }, DEFAULT_PARAMS);
    expect(quote.available).toBe(true);
    expect(quote.secondsToClear).toBe(2 * DAY);
    expect(quote.floored).toBe(true);
    expect(quote.feeBps).toBe(25);
    expect(quote.feeFloorSource).toBe("min-fee");
  });

  it("refuses gates, stale NAV, a short reserve, and a thin reserve policy", () => {
    const base = monthEpoch();
    expect(quoteExit({ ...base, gated: true }, DEFAULT_PARAMS).blocks.map((item) => item.code)).toContain("gated");
    expect(quoteExit({ ...base, navUpdatedAt: base.now - 8 * DAY }, DEFAULT_PARAMS).blocks.map((item) => item.code)).toContain("stale-nav");
    expect(quoteExit({ ...base, reserveBalance: 750n * U - 1n }, DEFAULT_PARAMS).blocks.map((item) => item.code)).toContain("reserve");
    expect(quoteExit({ ...base, reserveBps: 100 }, DEFAULT_PARAMS).blocks.map((item) => item.code)).toContain("reserve-policy");
  });

  it("rounds the reserve requirement up", () => {
    const nav = 10_000n * U + 1n;
    const required = mulDivCeil(nav, 750n, 10_000n);
    const base = { ...monthEpoch(), navValue: nav, exposure: 0n, limit: 50_000n * U };
    expect(quoteExit({ ...base, reserveBalance: required }, DEFAULT_PARAMS).available).toBe(true);
    expect(quoteExit({ ...base, reserveBalance: required - 1n }, DEFAULT_PARAMS).blocks.map((b) => b.code)).toContain("reserve");
  });

  it("refuses concentration above the cap and a closed window", () => {
    const crowded = quoteExit({
      ...monthEpoch(),
      navValue: 30_000n * U,
      limit: 80_000n * U,
      reserveBalance: 3_000n * U,
      bookAssets: 100_000n * U,
    }, { ...DEFAULT_PARAMS, concentrationCapBps: 2500 });
    expect(crowded.blocks.map((item) => item.code)).toContain("concentration");
    const now = 1_700_000_000;
    const open = quoteExit({
      ...weeklyClear(now),
      epochStart: now - 7 * DAY,
      requestedAt: now - 7 * DAY,
    }, DEFAULT_PARAMS);
    expect(open.blocks.map((item) => item.code)).toContain("window-open");
  });

  it("rejects a zero-history book as safer than a seasoned one would be", () => {
    const seasoned = quoteExit(monthEpoch(), DEFAULT_PARAMS);
    const cold = quoteExit({ ...monthEpoch(), repayment: emptyHistory() }, DEFAULT_PARAMS);
    expect(cold.risk.repayment).toBe(DEFAULT_PARAMS.unknownHistoryBps);
    expect(cold.risk.bps).toBeGreaterThan(seasoned.risk.bps);
    expect(cold.feeBps).toBeGreaterThanOrEqual(seasoned.feeBps);
  });

  it("rejects amounts below 1 USDG and a broken repayment history", () => {
    expect(() => quoteExit({ ...monthEpoch(), navValue: 1n }, DEFAULT_PARAMS)).toThrow(EngineError);
    expect(() => quoteExit({
      ...monthEpoch(),
      repayment: { samples: 2, onTime: 2, late: 1, slashed: 0, gateEvents: 0, windowsObserved: 2 },
    }, DEFAULT_PARAMS)).toThrow(EngineError);
  });
});
