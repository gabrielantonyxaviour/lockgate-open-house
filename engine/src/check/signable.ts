import { applyKasuRead, applyMapleRead, applyUsdaiRead } from "../adapters/apply.js";
import type { Mandate, QuoteInput } from "../domain.js";
import { EngineError } from "../errors.js";
import { mandateBlocks } from "../proposal/mandate.js";
import { routeVaults, type RoutePolicy, type VaultCandidate } from "../proposal/router.js";
import { applyMandateFloor, quoteExit, type Block, type Quote } from "../quote.js";
import type { CreConfig } from "../schema/config.js";
import type { CheckArea, CheckFinding } from "./config.js";

const LIMIT_CODES = new Set([
  "limit",
  "reserve",
  "reserve-policy",
  "concentration",
  "max-fee",
  "mandate-min",
  "platform-limit",
  "vault-concentration",
]);

function row(area: CheckArea, path: string, ok: boolean, code: string, message: string): CheckFinding {
  return { area, path, ok, code, message };
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function areaFor(code: string): CheckArea {
  if (code === "scan-truncated" || code === "illiquid") return "adapter";
  if (LIMIT_CODES.has(code)) return "limit";
  return "mandate";
}

function applyRead(input: QuoteInput, request: CreConfig["requests"][number]): QuoteInput {
  if (request.kasu) return applyKasuRead(input, request.kasu);
  if (request.maple) return applyMapleRead(input, request.maple);
  if (request.usdai) return applyUsdaiRead(input, request.usdai);
  return input;
}

/**
 * Price each request the way `cre-tick` does, then keep the block codes `buildProposal` would.
 * Signable means the routed vault has an empty list. The clock check uses this machine, as the tick does.
 */
export function signableFindings(config: CreConfig): CheckFinding[] {
  const candidates: VaultCandidate[] = config.vaults.map((vault) => ({
    mandate: vault.mandate,
    idle: vault.idle,
    cursor: vault.cursor,
  }));
  return config.requests.flatMap((request, index) => priceRequest(config, request, index, candidates));
}

function priceRequest(
  config: CreConfig,
  request: CreConfig["requests"][number],
  index: number,
  candidates: VaultCandidate[],
): CheckFinding[] {
  const path = `requests.${index}`;
  const approves = config.vaults.some((vault) =>
    vault.mandate.approvedPlatforms.some((item) => same(item, request.platform)),
  );
  if (!approves) return [];
  try {
    const input = applyRead({ ...request.input, now: config.now }, request);
    const priced = quoteExit(input, config.params);
    if (!priced.available) {
      return blocksOf(path, priced.blocks);
    }
    const choice = routeVaults(
      candidates,
      config.policy as RoutePolicy,
      config.params.maxFeeBps,
      config.now,
      request.platform,
      priced.navValue,
      config.roundRobin + index,
    );
    const mandate = choice ? candidates[choice.index]?.mandate : undefined;
    if (!choice || !mandate) {
      return [row("mandate", path, false, "no-vault", "no partner vault can take this exit inside its mandate")];
    }
    const blocks = signerBlocks(priced, input, mandate, request, config, Math.floor(Date.now() / 1000));
    if (blocks.length === 0) {
      return [row("mandate", path, true, "signable", "the routed vault can sign this advance")];
    }
    return blocksOf(path, blocks);
  } catch (err) {
    if (!(err instanceof EngineError)) throw err;
    return [row("mandate", path, false, err.code, err.message)];
  }
}

function signerBlocks(
  priced: Quote,
  input: QuoteInput,
  mandate: Mandate,
  request: CreConfig["requests"][number],
  config: CreConfig,
  wall: number,
): Block[] {
  const quote = applyMandateFloor(priced, mandate.minFeeBps, config.params.maxFeeBps);
  const blocks: Block[] = [
    ...quote.blocks,
    ...mandateBlocks(quote, input, mandate, request.platform, request.recipient, wall),
  ];
  const requestId = input.requestId ?? 0n;
  if (quote.available && blocks.length === quote.blocks.length && requestId === 0n) {
    blocks.push({ code: "request", reason: "a proposal must name a non-zero queue request" });
  }
  const expiresAt = Math.min(input.now + config.params.proposalTtlSeconds, mandate.expiresAt);
  if (quote.available && expiresAt <= input.now) {
    blocks.push({ code: "quote-expired", reason: "proposal expiry is not in the future" });
  }
  return blocks;
}

function blocksOf(path: string, blocks: Block[]): CheckFinding[] {
  return unique(blocks).map((block) => row(areaFor(block.code), path, false, block.code, block.reason));
}

function unique(blocks: Block[]): Block[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (seen.has(block.code)) return false;
    seen.add(block.code);
    return true;
  });
}
