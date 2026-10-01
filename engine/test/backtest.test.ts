import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { paramsSchema } from "../src/domain.js";
import { runBacktest } from "../src/backtest/harness.js";
import { SCENARIOS } from "../src/backtest/scenarios.js";
import { monthEpoch } from "../src/examples.js";

describe("backtest", () => {
  it("earns the fee on repayment and loses undeployed cash beyond the reserve on a slash", () => {
    const params = paramsSchema.parse(DEFAULT_PARAMS);
    const repaid = runBacktest(SCENARIOS["epoch-repay"](), params);
    expect(repaid.mismatches).toBe(0);
    expect(repaid.advanced).toBe(1);
    expect(repaid.feeEarned).toBe(repaid.ticks[0]?.quote.fee);
    const slashed = runBacktest(SCENARIOS["kasu-repay-slash"](), params);
    expect(slashed.mismatches).toBe(0);
    expect(slashed.loss).toBeGreaterThan(0n);
    const lossTick = slashed.ticks[1]!;
    const recovered = 750n * 1_000_000n;
    expect(lossTick.reserveUsed).toBe(recovered);
    expect(lossTick.loss).toBe(lossTick.quote.payout - recovered);
    expect(runBacktest(SCENARIOS["gated-refuse"](), params).refused).toBe(1);
    expect(runBacktest(SCENARIOS["stale-refuse"](), params).mismatches).toBe(0);
    expect(runBacktest(SCENARIOS["reserve-short"](), params).refused).toBe(1);
    expect(runBacktest(SCENARIOS["busy-book"](), params).feeEarned).toBeGreaterThan(repaid.feeEarned);
  });

  it("reprices the next advance higher after a slash", () => {
    const first = monthEpoch();
    const second = {
      ...first,
      now: first.now + 31 * 86_400,
      epochStart: first.now + 31 * 86_400,
      requestedAt: first.now + 31 * 86_400,
      navUpdatedAt: first.now + 31 * 86_400 - 60,
      requestId: 12n,
    };
    const report = runBacktest([
      { input: first, outcome: "slash" },
      { input: second, outcome: "repay" },
    ], paramsSchema.parse(DEFAULT_PARAMS));
    expect(report.ticks[1]!.quote.risk.bps).toBeGreaterThan(report.ticks[0]!.quote.risk.bps);
    expect(report.ticks[1]!.quote.feeBps).toBeGreaterThanOrEqual(report.ticks[0]!.quote.feeBps);
  });
});
