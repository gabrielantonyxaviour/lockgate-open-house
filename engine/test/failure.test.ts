import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch, weeklyClear } from "../src/examples.js";
import { quoteExit } from "../src/quote.js";
import { mulDivCeil, mulDivRoundHalfUp } from "../src/money.js";
import { planSweep } from "../src/sweep/sweep.js";
import { runBacktest } from "../src/backtest/harness.js";
import { run } from "../src/cli.js";
import { EngineError } from "../src/errors.js";

const DAY = 86_400;
const now = 1_700_000_000;

describe("failure paths", () => {
  it("rejects a decreasing curve, a future NAV, and a partial scan", () => {
    expect(() => quoteExit(monthEpoch(now), { ...DEFAULT_PARAMS, aprAtKinkBps: 100 })).toThrow(EngineError);
    expect(() => quoteExit({ ...monthEpoch(now), navUpdatedAt: now + 1 }, DEFAULT_PARAMS)).toThrow(EngineError);
    const scanned = quoteExit({ ...monthEpoch(now), truncated: true }, DEFAULT_PARAMS);
    expect(scanned.available).toBe(false);
    expect(scanned.blocks.map((item) => item.code)).toContain("scan-truncated");
    expect(scanned.fee).toBe(0n);
  });

  it("treats unknown Kasu cash as illiquid and a clearing-window request as the next epoch", () => {
    const blind = quoteExit({ ...weeklyClear(now), cashKnown: false }, DEFAULT_PARAMS);
    expect(blind.blocks.map((item) => item.code)).toContain("illiquid");
    const during = quoteExit({
      ...weeklyClear(now),
      epochStart: now - 6 * DAY,
      requestedAt: now,
    }, DEFAULT_PARAMS);
    const before = quoteExit(weeklyClear(now), DEFAULT_PARAMS);
    expect(during.secondsToClear).toBeGreaterThan(before.secondsToClear);
  });

  it("repays at the exact due instant and refuses a mainnet sweep", () => {
    const due = planSweep({
      chainId: 31337,
      now,
      graceSeconds: DAY,
      advances: [{
        id: "9",
        vault: "0x00000000000000000000000000000000000000c1",
        platform: "0x00000000000000000000000000000000000000b1",
        navValue: "1000",
        dueAt: now,
        status: "active",
        cash: "1000",
        vaultKind: "own-book",
      }],
    });
    expect(due[0]?.kind).toBe("repay");
    expect(due[0]?.sendable).toBe(true);
    expect(() => planSweep({ chainId: 8453, now, graceSeconds: 0, advances: [] })).toThrow(EngineError);
    expect(() => planSweep({ chainId: 31337, now, graceSeconds: -1, advances: [] })).toThrow(EngineError);
  });

  it("rejects an unknown backtest outcome and an unknown CLI command", async () => {
    expect(() => runBacktest([{
      input: monthEpoch(now),
      outcome: "default" as "repay",
    }], DEFAULT_PARAMS)).toThrow(EngineError);
    await expect(run(["nope"])).rejects.toThrow(EngineError);
  });

  it("rounds half up within one unit and never past the ceiling", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 0n, max: 10n ** 24n }),
      fc.bigInt({ min: 0n, max: 10n ** 12n }),
      fc.bigInt({ min: 1n, max: 10n ** 12n }),
      (amount, numerator, denominator) => {
        const floor = (amount * numerator) / denominator;
        const half = mulDivRoundHalfUp(amount, numerator, denominator);
        const ceil = mulDivCeil(amount, numerator, denominator);
        expect(half === floor || half === floor + 1n).toBe(true);
        expect(ceil === floor || ceil === floor + 1n).toBe(true);
        expect(ceil).toBeGreaterThanOrEqual(half > ceil ? half : ceil);
        expect(ceil).toBeGreaterThanOrEqual(floor);
      },
    ), { numRuns: 100 });
  });
});
