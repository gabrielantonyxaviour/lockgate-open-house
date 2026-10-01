import { MAX_NAV, MIN_NAV, SECONDS_PER_YEAR, mulDivCeil, mulDivRoundHalfUp } from "./money.js";
import { utilizationAprBps } from "./pricing/curve.js";
import { scoreRisk, type RiskBreakdown } from "./risk/score.js";
import { waitFor, type WaitResult } from "./adapters/wait.js";
import { EngineError } from "./errors.js";
import {
  parseOrThrow,
  paramsSchema,
  quoteInputSchema,
  type PricingParams,
  type QuoteInput,
} from "./domain.js";

export type Block = { code: string; reason: string };

export type AprParts = {
  utilization: number;
  risk: number;
  navAge: number;
  concentration: number;
  total: number;
};

export type Quote = {
  available: boolean;
  platformId: string;
  kind: QuoteInput["kind"];
  navValue: bigint;
  fee: bigint;
  payout: bigint;
  feeBps: number;
  riskFeeBps: number;
  blocks: Block[];
  secondsToClear: number;
  pricedSeconds: number;
  dueAt: number;
  rollovers: number;
  assumption?: string;
  apr: AprParts;
  risk: RiskBreakdown;
  capped: boolean;
  floored: boolean;
  feeFloorSource: "risk" | "min-fee" | "mandate-min" | "none";
  reserveRequired: bigint;
  exposureAfter: bigint;
};

function block(code: string, reason: string): Block {
  return { code, reason };
}

function exposureBps(exposureAfter: bigint, book: bigint): number {
  const base = book > exposureAfter ? book : exposureAfter;
  if (base === 0n) return 10_000;
  const bps = (exposureAfter * 10_000n) / base;
  return bps > 10_000n ? 10_000 : Number(bps);
}

export function quoteExit(rawInput: unknown, rawParams: unknown): Quote {
  const input = parseOrThrow(quoteInputSchema, rawInput);
  const params = parseOrThrow(paramsSchema, rawParams);
  if (input.navValue < MIN_NAV || input.navValue > MAX_NAV) {
    throw new EngineError("amount", "navValue must be between 1 USDG and 1e12 USDG");
  }
  if (input.navUpdatedAt > input.now) throw new EngineError("param", "NAV timestamp is in the future");

  const wait = waitFor(input);
  const navAge = input.now - input.navUpdatedAt;
  const exposureAfter = input.exposure + input.navValue;
  const bookBps = exposureBps(exposureAfter, input.bookAssets);
  const risk = scoreRisk(input, params, wait.rollovers, bookBps, navAge);
  const apr = assembleApr(input, params, risk.bps, navAge, bookBps);
  const reserveRequired = mulDivCeil(exposureAfter, BigInt(input.reserveBps), 10_000n);
  const pricedSeconds = wait.illiquid ? 0 : wait.secondsToClear * params.timeScale;
  const rawFeeBps = feeBpsFor(apr.total, pricedSeconds);
  const floored = rawFeeBps < params.minFeeBps && !wait.illiquid && !wait.windowOpen;
  const capped = rawFeeBps > params.maxFeeBps;
  const charged = Math.min(params.maxFeeBps, Math.max(params.minFeeBps, rawFeeBps));
  const blocks = collectBlocks(input, params, wait, navAge, exposureAfter, reserveRequired, bookBps, charged);
  const fee = blocks.length === 0 ? mulDivRoundHalfUp(input.navValue, BigInt(charged), 10_000n) : 0n;
  const payout = blocks.length === 0 ? input.navValue - fee : 0n;
  if (blocks.length === 0 && payout + fee !== input.navValue) {
    throw new EngineError("invariant", "payout and fee do not sum to nav");
  }
  return {
    available: blocks.length === 0,
    platformId: input.platformId,
    kind: input.kind,
    navValue: input.navValue,
    fee,
    payout,
    feeBps: blocks.length === 0 ? charged : 0,
    riskFeeBps: rawFeeBps,
    blocks,
    secondsToClear: wait.secondsToClear,
    pricedSeconds,
    dueAt: wait.dueAt,
    rollovers: wait.rollovers,
    assumption: wait.assumption,
    apr,
    risk,
    capped,
    floored,
    feeFloorSource: blocks.length === 0 ? (floored ? "min-fee" : "risk") : "none",
    reserveRequired,
    exposureAfter,
  };
}

function assembleApr(
  input: QuoteInput,
  params: PricingParams,
  riskBps: number,
  navAge: number,
  bookBps: number,
): AprParts {
  const utilization = utilizationAprBps(input.utilizationBps, params);
  const risk = Number(mulDivRoundHalfUp(BigInt(riskBps), BigInt(params.maxRiskPremiumAprBps), 10_000n));
  let navAgeApr = 0;
  if (navAge > params.navWarnSeconds && navAge <= params.maxNavAgeSeconds) {
    const span = params.maxNavAgeSeconds - params.navWarnSeconds;
    const num = navAge - params.navWarnSeconds;
    navAgeApr = Number(mulDivRoundHalfUp(BigInt(params.navAgeMaxPremiumAprBps) * BigInt(num), 1n, BigInt(span)));
  }
  const concentration = Number(
    mulDivRoundHalfUp(BigInt(Math.min(bookBps, params.concentrationCapBps)), BigInt(params.concentrationMaxPremiumAprBps), BigInt(params.concentrationCapBps)),
  );
  return { utilization, risk, navAge: navAgeApr, concentration, total: utilization + risk + navAgeApr + concentration };
}

function feeBpsFor(totalAprBps: number, pricedSeconds: number): number {
  if (pricedSeconds <= 0 || totalAprBps <= 0) return 0;
  return Number(mulDivRoundHalfUp(BigInt(totalAprBps) * BigInt(pricedSeconds), 1n, SECONDS_PER_YEAR));
}

function collectBlocks(
  input: QuoteInput,
  params: PricingParams,
  wait: WaitResult,
  navAge: number,
  exposureAfter: bigint,
  reserveRequired: bigint,
  bookBps: number,
  chargedBps: number,
): Block[] {
  const blocks: Block[] = [];
  if (input.reserveBps < 500 || input.reserveBps > 1_000) {
    blocks.push(block("reserve-policy", "platform reserve ratio must be 5% to 10%"));
  }
  if (input.gated) blocks.push(block("gated", "platform withdrawals are gated"));
  if (navAge > params.maxNavAgeSeconds) blocks.push(block("stale-nav", "NAV is older than the platform maximum"));
  if (input.truncated && !input.allowPartialScan) {
    blocks.push(block("scan-truncated", "queue scan was partial, so the depth is a lower bound"));
  }
  if (wait.illiquid) blocks.push(block("illiquid", "cash does not clear this queue inside the rollover bound"));
  if (wait.windowOpen) blocks.push(block("window-open", "the queue window is already open"));
  if (!wait.illiquid && !wait.windowOpen && wait.secondsToClear > params.maxTenorSeconds) {
    blocks.push(block("tenor", "expected wait is longer than the maximum tenor"));
  }
  if (exposureAfter > input.limit) blocks.push(block("limit", "advance would exceed the platform limit"));
  if (bookBps > params.concentrationCapBps) {
    blocks.push(block("concentration", "advance would exceed the concentration cap"));
  }
  if (input.reserveBalance < reserveRequired) {
    blocks.push(block("reserve", "posted reserve does not cover exposure after this advance"));
  }
  if (blocks.length === 0 && chargedBps > params.maxFeeBps) {
    blocks.push(block("max-fee", "fee would exceed the maximum"));
  }
  return blocks;
}

export function applyMandateFloor(quote: Quote, mandateMinFeeBps: number, maxFeeBps: number): Quote {
  if (!quote.available) return quote;
  if (mandateMinFeeBps > maxFeeBps) {
    return {
      ...quote,
      available: false,
      fee: 0n,
      payout: 0n,
      feeBps: 0,
      feeFloorSource: "none",
      blocks: [...quote.blocks, block("mandate-min", "vault minimum fee is above the protocol maximum")],
    };
  }
  if (quote.feeBps >= mandateMinFeeBps) return quote;
  const fee = mulDivRoundHalfUp(quote.navValue, BigInt(mandateMinFeeBps), 10_000n);
  return {
    ...quote,
    feeBps: mandateMinFeeBps,
    fee,
    payout: quote.navValue - fee,
    floored: true,
    feeFloorSource: "mandate-min",
  };
}
