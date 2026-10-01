import { z } from "zod";
import { assertTransactableChain } from "../chains.js";
import { mandateSchema, paramsSchema, parseOrThrow, quoteInputSchema, zAddress, zAmount } from "../domain.js";
import { quoteExit } from "../quote.js";
import { alertsForQuote, type Alert } from "../alert/evaluate.js";
import { buildProposal, type BuiltProposal } from "../proposal/build.js";
import { routeVaults, type RoutePolicy, type VaultCandidate } from "../proposal/router.js";

export const creConfigSchema = z.object({
  chainId: z.number().int().positive(),
  now: z.number().int().nonnegative(),
  params: paramsSchema,
  policy: z.enum(["lowest-fee", "most-capacity", "round-robin"]).default("lowest-fee"),
  roundRobin: z.number().int().nonnegative().default(0),
  vaults: z.array(z.object({
    mandate: mandateSchema,
    idle: zAmount,
    cursor: z.number().int().nonnegative(),
  })).min(1).max(32),
  requests: z.array(z.object({
    input: quoteInputSchema,
    platform: zAddress,
    recipient: zAddress,
    nonce: zAmount,
  })).min(1).max(32),
});

export type CreTick = {
  proposals: BuiltProposal[];
  alerts: Alert[];
  skipped: { platformId: string; code: string }[];
};

/**
 * Local stand-in for a Chainlink CRE cron handler. Prices, routes, and builds
 * submitProposal calldata. It does not broadcast. See engine/cre/CRE.md.
 */
export function runCreTick(raw: unknown): CreTick {
  const config = parseOrThrow(creConfigSchema, raw, "param");
  assertTransactableChain(config.chainId);
  const proposals: BuiltProposal[] = [];
  const alerts: Alert[] = [];
  const skipped: CreTick["skipped"] = [];
  const candidates: VaultCandidate[] = config.vaults.map((vault) => ({
    mandate: vault.mandate,
    idle: vault.idle,
    cursor: vault.cursor,
  }));
  config.requests.forEach((request, index) => {
    const input = { ...request.input, now: config.now };
    const preview = quoteExit(input, config.params);
    alerts.push(...alertsForQuote(input, preview, config.params));
    if (!preview.available) {
      skipped.push({ platformId: input.platformId, code: preview.blocks[0]?.code ?? "refused" });
      return;
    }
    const choice = routeVaults(
      candidates,
      config.policy as RoutePolicy,
      config.params.maxFeeBps,
      config.now,
      request.platform,
      preview.navValue,
      config.roundRobin + index,
    );
    if (!choice) {
      skipped.push({ platformId: input.platformId, code: "no-vault" });
      alerts.push({
        severity: "warn",
        code: "no-vault",
        platformId: input.platformId,
        message: "no partner vault can take this exit inside its mandate",
        evidence: { feeBps: preview.feeBps },
      });
      return;
    }
    const mandate = candidates[choice.index]?.mandate;
    if (!mandate) {
      skipped.push({ platformId: input.platformId, code: "no-vault" });
      return;
    }
    const proposal = buildProposal({
      input,
      params: config.params,
      mandate,
      platform: request.platform,
      recipient: request.recipient,
      chainId: config.chainId,
      nonce: request.nonce,
    });
    if (!proposal.submittable) {
      skipped.push({ platformId: input.platformId, code: proposal.blocks[0]?.code ?? "refused" });
      return;
    }
    proposals.push(proposal);
  });
  return { proposals, alerts, skipped };
}
