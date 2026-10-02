import type { Address } from "viem";
import type { Mandate, QuoteInput } from "../domain.js";
import { EngineError } from "../errors.js";
import type { Block, Quote } from "../quote.js";

function limitFor(mandate: Mandate, platform: Address): bigint | undefined {
  if (mandate.platformLimits[platform] !== undefined) return mandate.platformLimits[platform];
  const lower = platform.toLowerCase();
  for (const [key, value] of Object.entries(mandate.platformLimits)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

const CLOCK_AHEAD_SECONDS = 86_400;

export function mandateBlocks(
  quote: Quote,
  input: QuoteInput,
  mandate: Mandate,
  platform: Address,
  recipient: Address,
  wall = Math.floor(Date.now() / 1000),
): Block[] {
  const blocks: Block[] = [];
  if (!Number.isInteger(wall) || wall < 0) {
    throw new EngineError("param", "wall clock must be a non-negative integer");
  }
  if (input.now > wall + CLOCK_AHEAD_SECONDS) {
    blocks.push({ code: "clock", reason: "quote clock is more than a day ahead of this machine" });
  }
  if (mandate.paused) blocks.push({ code: "paused", reason: "vault is paused" });
  if (mandate.expiresAt <= input.now) {
    blocks.push({ code: "mandate-expired", reason: "mandate has expired" });
  }
  const approved = mandate.approvedPlatforms.some((item) => item.toLowerCase() === platform.toLowerCase());
  if (!approved) blocks.push({ code: "platform", reason: "platform is not on this mandate" });
  const expected = mandate.payoutTo ?? platform;
  if (recipient.toLowerCase() !== expected.toLowerCase()) {
    blocks.push({ code: "recipient", reason: "recipient is not the platform payout address" });
  }
  const cap = limitFor(mandate, platform);
  if (cap === undefined) blocks.push({ code: "platform-limit", reason: "mandate has no limit for this platform" });
  else if (quote.exposureAfter > cap) {
    blocks.push({ code: "platform-limit", reason: "mandate platform limit would be exceeded" });
  }
  if (quote.secondsToClear > mandate.maxTenorSeconds) {
    blocks.push({ code: "tenor", reason: "wait exceeds the mandate tenor" });
  }
  const book = input.bookAssets > quote.exposureAfter ? input.bookAssets : quote.exposureAfter;
  const bps = book === 0n ? 10_000 : Number((quote.exposureAfter * 10_000n) / book);
  if (bps > mandate.concentrationCapBps) {
    blocks.push({ code: "concentration", reason: "mandate concentration cap would be exceeded" });
  }
  if (input.truncated && !quote.blocks.some((item) => item.code === "scan-truncated")) {
    blocks.push({ code: "scan-truncated", reason: "a partial queue scan cannot be signed" });
  }
  if (quote.available && quote.fee >= quote.navValue) {
    blocks.push({ code: "zero-payout", reason: "fee leaves no payout the vault can fund" });
  }
  if (quote.available) {
    const floor = (quote.navValue * BigInt(mandate.minFeeBps)) / 10_000n;
    if (quote.fee < floor) blocks.push({ code: "fee", reason: "fee is below the vault floor" });
  }
  if (mandate.idle === undefined || mandate.totalAssets === undefined) {
    blocks.push({ code: "vault-snapshot", reason: "idle cash and vault assets are required before signing" });
    return blocks;
  }
  if (quote.available && quote.payout > mandate.idle) {
    blocks.push({ code: "cash", reason: "payout exceeds vault idle cash" });
  }
  const vaultCap = (mandate.totalAssets * BigInt(mandate.concentrationCapBps)) / 10_000n;
  if (quote.navValue > vaultCap || quote.exposureAfter > vaultCap) {
    blocks.push({ code: "vault-concentration", reason: "vault asset concentration cap would be exceeded" });
  }
  return blocks;
}
