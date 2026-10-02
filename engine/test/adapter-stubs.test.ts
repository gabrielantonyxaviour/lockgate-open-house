import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyBufferOrWindow,
  applyCalendarCohort,
  applyCappedFifo,
  applyGatedRepurchase,
  applyLockCooldown,
  applyTwoCycle,
  CATEGORY_STUBS,
  LIVE_READERS,
  OFFER_NOTICE,
  REQUEST_DEADLINE,
} from "../src/adapters/stubs.js";
import { readKasu } from "../src/adapters/kasu/read.js";
import { readMaple } from "../src/adapters/maple/read.js";
import { readUsdai } from "../src/adapters/usdai/read.js";
import { monthEpoch } from "../src/examples.js";
import { EngineError } from "../src/errors.js";
import { parseJson } from "../src/json.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { quoteExit } from "../src/quote.js";

const AS_OF = OFFER_NOTICE + 86_400;

function load(name: string): unknown {
  const file = new URL(`../fixtures/adapters/${name}.json`, import.meta.url);
  return parseJson(readFileSync(file, "utf8"));
}

function bare() {
  const row = monthEpoch(AS_OF);
  return {
    ...row,
    epochStart: undefined,
    epochSeconds: undefined,
    windowSeconds: undefined,
    cutoffSeconds: undefined,
    requestedAt: AS_OF,
  };
}

describe("G4 redemption stubs", () => {
  it("keeps Kasu, Maple, and sUSDai as the live readers", () => {
    expect(LIVE_READERS).toEqual(["kasu", "maple", "usdai"]);
    expect(typeof readKasu).toBe("function");
    expect(typeof readMaple).toBe("function");
    expect(typeof readUsdai).toBe("function");
    expect(CATEGORY_STUBS.map((item) => item.category)).toEqual([
      "quarterly-gated-repurchase",
      "two-cycle-vault",
      "buffer-or-window",
      "calendar-cohort",
      "lock-then-cooldown",
      "capped-fifo",
    ]);
    expect(CATEGORY_STUBS.every((item) => item.live === false)).toBe(true);
  });

  it("prices ACRED's printed request window and does not copy either 5% sentence", () => {
    const applied = applyGatedRepurchase(bare(), load("acred-quarter"));
    expect(applied.clock).toBe(true);
    expect(applied.input.kind).toBe("quarterly-gated");
    expect(applied.input.epochStart).toBe(OFFER_NOTICE);
    expect(applied.input.windowSeconds).toBe(REQUEST_DEADLINE - OFFER_NOTICE);
    expect(applied.input.cashKnown).toBe(false);
    expect(applied.input.reserveBps).toBe(750);
    expect(applied.notes).toEqual([
      "no-queue-amount",
      "offer-and-cap-differ",
      "request-deadline",
      "underlying-deadline-not-due",
    ]);
    const quote = quoteExit(applied.input, DEFAULT_PARAMS);
    expect(quote.available).toBe(false);
    expect(quote.blocks.map((block) => block.code)).toContain("illiquid");
  });

  it("leaves a quarterly page with no dates off the quote clock", () => {
    const fullerton = applyGatedRepurchase(bare(), load("fullerton-gate"));
    expect(fullerton.clock).toBe(false);
    expect(fullerton.input.kind).toBe("epoch");
    expect(fullerton.input.epochStart).toBeUndefined();
    expect(fullerton.notes).toEqual(["no-queue-amount", "gate-unprinted", "clock-unprinted"]);
    const tradeflow = applyGatedRepurchase(bare(), load("tradeflow-liquidity"));
    expect(tradeflow.clock).toBe(false);
    expect(tradeflow.notes).toContain("ninety-day-unlabeled");
    expect(() => applyGatedRepurchase(bare(), { category: "quarterly-gated-repurchase", platform: "acred", offerBps: 20_000, capBps: null })).toThrow(EngineError);
  });

  it("records a 7-day Pareto cycle and does not invent a month length", () => {
    const open = { ...bare(), epochStart: AS_OF };
    const week = applyTwoCycle(open, load("pareto-week"));
    expect(week.clock).toBe(true);
    expect(week.input.kind).toBe("epoch");
    expect(week.input.epochSeconds).toBe(7 * 86_400);
    expect(week.input.cashKnown).toBe(false);
    expect(week.notes).toEqual(["no-queue-amount", "claim-next-cycle", "buffer-24h", "cycle-7d"]);
    expect(quoteExit(week.input, DEFAULT_PARAMS).blocks.map((block) => block.code)).toContain("illiquid");
    const undated = applyTwoCycle(bare(), load("pareto-week"));
    expect(undated.clock).toBe(false);
    expect(undated.notes).toContain("epoch-start-unprinted");
    const month = applyTwoCycle(open, load("pareto-month"));
    expect(month.clock).toBe(false);
    expect(month.input.epochSeconds).toBeUndefined();
    expect(month.notes).toEqual(["no-queue-amount", "claim-next-cycle", "early-exit", "cycle-not-in-seconds"]);
  });

  it("does not invent a clock for Re, GAIB, 3Jane, or HYBOND", () => {
    const input = bare();
    const buffer = applyBufferOrWindow(input, load("re-buffer"));
    expect(buffer).toEqual({ input, notes: ["instant-buffer"], clock: false });
    const window = applyBufferOrWindow(input, load("re-window"));
    expect(window.clock).toBe(false);
    expect(window.notes).toEqual(["window-date-unprinted", "pro-rata-returned"]);
    const cohort = applyCalendarCohort(input, load("gaib-cohort"));
    expect(cohort.notes).toEqual(["how-to-next-month", "said-month-after-next"]);
    expect(cohort.input.epochStart).toBeUndefined();
    const lock = applyLockCooldown(input, load("jane-lock"));
    expect(lock.notes).toEqual(["cooldown-unprinted", "window-unprinted"]);
    expect(lock.input).toBe(input);
    const fifo = applyCappedFifo(input, load("hybond-fifo"));
    expect(fifo.clock).toBe(false);
    expect(fifo.input.kind).toBe("epoch");
    expect(fifo.input.coveredWaitSeconds).toBeUndefined();
    expect(fifo.notes).toEqual(["cap-1000-bps", "t-plus-4-business-days", "no-queue-amount"]);
  });
});
