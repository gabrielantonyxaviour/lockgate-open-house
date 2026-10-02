import { describe, expect, it } from "vitest";
import { monthEpoch } from "../src/examples.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { quoteExit } from "../src/quote.js";

describe("gate history", () => {
  it("still offers the whole open book after a 5% gate in history", () => {
    const open = monthEpoch();
    const quoted = quoteExit({
      ...open,
      gated: false,
      repayment: { samples: 20, onTime: 20, late: 0, slashed: 0, gateEvents: 1, windowsObserved: 20 },
    }, DEFAULT_PARAMS);
    expect(quoted.available).toBe(true);
    expect(quoted.blocks.map((item) => item.code)).not.toContain("gated");
    expect(quoted.navValue).toBe(open.navValue);
    expect(quoted.payout + quoted.fee).toBe(open.navValue);
  });
});
