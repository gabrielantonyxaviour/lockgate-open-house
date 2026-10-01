import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch } from "../src/examples.js";
import { alertsForQuote } from "../src/alert/evaluate.js";
import { quoteExit } from "../src/quote.js";

const now = 1_700_000_000;
const PAR = 100_000_000n;

function peg(patch: Record<string, unknown> = {}) {
  return {
    enabled: true,
    priceE8: PAR,
    updatedAt: now,
    minPriceE8: PAR,
    maxOracleAge: 3_600,
    ...patch,
  };
}

describe("peg", () => {
  it("ignores a disabled oracle and a price sitting on the floor", () => {
    const open = quoteExit(monthEpoch(now), DEFAULT_PARAMS);
    const skipped = quoteExit({ ...monthEpoch(now), peg: peg({ enabled: false, priceE8: 1n }) }, DEFAULT_PARAMS);
    const onFloor = quoteExit({ ...monthEpoch(now), peg: peg() }, DEFAULT_PARAMS);
    expect(skipped.available).toBe(true);
    expect(skipped.feeBps).toBe(open.feeBps);
    expect(onFloor.available).toBe(true);
    expect(onFloor.blocks).toEqual([]);
  });

  it("stops on a depeg and on a stale or zero-age oracle, without stacking both", () => {
    const cheap = quoteExit({ ...monthEpoch(now), peg: peg({ priceE8: PAR - 1n }) }, DEFAULT_PARAMS);
    expect(cheap.available).toBe(false);
    expect(cheap.fee).toBe(0n);
    expect(cheap.blocks.map((item) => item.code)).toEqual(["peg"]);
    const stale = quoteExit({
      ...monthEpoch(now),
      peg: peg({ updatedAt: now - 3_601, priceE8: 1n }),
    }, DEFAULT_PARAMS);
    expect(stale.blocks.map((item) => item.code)).toEqual(["stale-oracle"]);
    const closed = quoteExit({ ...monthEpoch(now), peg: peg({ maxOracleAge: 0 }) }, DEFAULT_PARAMS);
    expect(closed.blocks.map((item) => item.code)).toContain("stale-oracle");
    const future = quoteExit({ ...monthEpoch(now), peg: peg({ updatedAt: now + 1 }) }, DEFAULT_PARAMS);
    expect(future.blocks.map((item) => item.code)).toContain("stale-oracle");
    const edge = quoteExit({ ...monthEpoch(now), peg: peg({ updatedAt: now - 3_600 }) }, DEFAULT_PARAMS);
    expect(edge.available).toBe(true);
  });

  it("raises a critical alert for a depeg and stays quiet when the oracle is off", () => {
    const input = { ...monthEpoch(now), peg: peg({ priceE8: PAR - 1n }) };
    const quote = quoteExit(input, DEFAULT_PARAMS);
    const alerts = alertsForQuote(input, quote, DEFAULT_PARAMS);
    expect(alerts.find((item) => item.code === "peg")?.severity).toBe("critical");
    const off = { ...monthEpoch(now), peg: peg({ enabled: false, priceE8: 1n }) };
    const quiet = alertsForQuote(off, quoteExit(off, DEFAULT_PARAMS), DEFAULT_PARAMS);
    expect(quiet.some((item) => item.code === "peg" || item.code === "stale-oracle")).toBe(false);
  });
});
