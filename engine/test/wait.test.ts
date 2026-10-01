import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, QUEUE } from "../src/pricing/defaults.js";
import { quoteExit } from "../src/quote.js";
import { mapleCovered, monthEpoch, weeklyClear } from "../src/examples.js";

const DAY = 86_400;
const U = 1_000_000n;

describe("queue clocks", () => {
  it("uses Kasu's 7-day epoch and 48-hour clearing", () => {
    expect(QUEUE.kasuEpochSeconds).toBe(604_800);
    expect(QUEUE.kasuClearingSeconds).toBe(172_800);
    const now = 1_700_000_000;
    const before = quoteExit(weeklyClear(now), DEFAULT_PARAMS);
    expect(before.secondsToClear).toBe(5 * DAY);
    const during = quoteExit({
      ...weeklyClear(now),
      epochStart: now - 6 * DAY,
      requestedAt: now,
    }, DEFAULT_PARAMS);
    expect(during.secondsToClear).toBe(8 * DAY);
  });

  it("rolls a Kasu request an extra epoch when this window cannot pay it", () => {
    const now = 1_700_000_000;
    const quote = quoteExit({
      ...weeklyClear(now),
      cashAvailable: 0n,
      cashPerEpoch: 10_000n * U,
    }, DEFAULT_PARAMS);
    expect(quote.rollovers).toBe(1);
    expect(quote.secondsToClear).toBe(5 * DAY + 7 * DAY);
  });

  it("refuses a cyclical queue with no cash forecast", () => {
    const quote = quoteExit({ ...weeklyClear(), cashAvailable: 0n, cashPerEpoch: 0n }, DEFAULT_PARAMS);
    expect(quote.blocks.map((item) => item.code)).toContain("illiquid");
  });

  it("sends an epoch request made on the cutoff day to the following epoch", () => {
    const start = 1_700_000_000;
    const now = start + 29 * DAY + 10;
    const quote = quoteExit({
      ...monthEpoch(now),
      epochStart: start,
      requestedAt: now,
    }, DEFAULT_PARAMS);
    expect(quote.dueAt).toBe(start + 60 * DAY);
  });

  it("prices Maple's covered queue inside a day and an unknown queue at 30 days", () => {
    const covered = quoteExit(mapleCovered(), DEFAULT_PARAMS);
    expect(covered.assumption).toBe("maple-under-24h");
    expect(covered.secondsToClear).toBe(DAY);
    expect(covered.feeBps).toBe(25);
    const unknown = quoteExit({ ...mapleCovered(), cashKnown: false }, DEFAULT_PARAMS);
    expect(unknown.assumption).toBe("maple-worst-case-30d");
    expect(unknown.secondsToClear).toBe(30 * DAY);
    const short = quoteExit({ ...mapleCovered(), cashAvailable: 1n }, DEFAULT_PARAMS);
    expect(short.assumption).toBe("maple-liquidity-short");
    expect(short.secondsToClear).toBe(30 * DAY);
  });
});
