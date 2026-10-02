import { applyKasuRead, applyMapleRead, applyUsdaiRead } from "../adapters/apply.js";
import type { KasuRead } from "../adapters/kasu/read.js";
import type { MapleRead } from "../adapters/maple/read.js";
import type { UsdaiRead } from "../adapters/usdai/read.js";
import { assertTransactableChain } from "../chains.js";
import type { QuoteInput } from "../domain.js";
import { asApiError, type ApiError } from "../errors.js";
import { quoteExit } from "../quote.js";
import { alertsForQuote, type Alert } from "../alert/evaluate.js";
import { buildProposal, type BuiltProposal } from "../proposal/build.js";
import { routeVaults, type RoutePolicy, type VaultCandidate } from "../proposal/router.js";
import { parseConfig } from "../schema/config.js";

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
  const config = parseConfig(raw);
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
    const input = applyRead({ ...request.input, now: config.now }, request);
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

function applyRead(
  input: QuoteInput,
  request: { kasu?: KasuRead; maple?: MapleRead; usdai?: UsdaiRead },
): QuoteInput {
  if (request.kasu) return applyKasuRead(input, request.kasu);
  if (request.maple) return applyMapleRead(input, request.maple);
  if (request.usdai) return applyUsdaiRead(input, request.usdai);
  return input;
}

/** CRE entry. A bad config or a forbidden chain is `{ error, code }`, never a throw or a stack. */
export function creEntry(raw: unknown): CreTick | ApiError {
  try {
    return runCreTick(raw);
  } catch (err) {
    return asApiError(err);
  }
}
