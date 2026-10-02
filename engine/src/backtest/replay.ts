import { z } from "zod";
import type { Hex } from "viem";
import {
  mandateSchema,
  paramsSchema,
  parseOrThrow,
  quoteInputSchema,
  zAddress,
  zAmount,
  type RepaymentHistory,
} from "../domain.js";
import { EngineError } from "../errors.js";
import { DEFAULT_PARAMS } from "../pricing/defaults.js";
import { buildProposal } from "../proposal/build.js";
import { applyHistory, runBacktest, type TickOutcome } from "./harness.js";

const scenarioSchema = z.object({
  chainId: z.number().int().positive(),
  platform: zAddress,
  recipient: zAddress,
  mandate: mandateSchema,
  ticks: z.array(z.object({
    outcome: z.enum(["repay", "late", "slash", "refuse"]),
    nonce: zAmount,
    input: quoteInputSchema,
  })).min(1).max(32),
});

export type ProposalBytes = {
  digest: Hex;
  calldata: Hex;
  feeBps: number;
  fee: bigint;
};

/**
 * Replay a recorded queue tape with the engine's default params.
 * Each tick must stay submittable. Digest, calldata, and the charged fee are the proposal bytes.
 */
export function replayRecordedQueue(raw: unknown): ProposalBytes[] {
  const scenario = parseOrThrow(scenarioSchema, raw);
  const params = parseOrThrow(paramsSchema, DEFAULT_PARAMS);
  const report = runBacktest(
    scenario.ticks.map((tick) => ({ input: tick.input, outcome: tick.outcome as TickOutcome })),
    params,
  );
  const history = new Map<string, RepaymentHistory>();
  return scenario.ticks.map((tick, index) => {
    const prior = history.get(tick.input.platformId) ?? tick.input.repayment;
    const input = { ...tick.input, repayment: prior };
    const built = buildProposal({
      input,
      params,
      mandate: scenario.mandate,
      platform: scenario.platform,
      recipient: scenario.recipient,
      chainId: scenario.chainId,
      nonce: tick.nonce,
    });
    history.set(input.platformId, applyHistory(prior, tick.outcome));
    const quoted = report.ticks[index]?.quote;
    if (!quoted || quoted.fee !== built.quote.fee || quoted.feeBps !== built.quote.feeBps) {
      throw new EngineError("invariant", "backtest quote and proposal quote diverged");
    }
    if (!built.submittable) {
      throw new EngineError("refused", built.blocks[0]?.code ?? "refused");
    }
    if (built.digest !== built.partner.digest || built.calldata !== built.partner.submitCalldata) {
      throw new EngineError("invariant", "proposal bytes diverged from the filing");
    }
    return {
      digest: built.digest,
      calldata: built.calldata,
      feeBps: built.quote.feeBps,
      fee: built.quote.fee,
    };
  });
}
