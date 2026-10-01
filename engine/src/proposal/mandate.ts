import type { Address } from "viem";
import type { Mandate, QuoteInput } from "../domain.js";
import type { Block, Quote } from "../quote.js";

function limitFor(mandate: Mandate, platform: Address): bigint | undefined {
  if (mandate.platformLimits[platform] !== undefined) return mandate.platformLimits[platform];
  const lower = platform.toLowerCase();
  for (const [key, value] of Object.entries(mandate.platformLimits)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function mandateBlocks(
  quote: Quote,
  input: QuoteInput,
  mandate: Mandate,
  platform: Address,
): Block[] {
  const blocks: Block[] = [];
  if (mandate.expiresAt <= input.now) {
    blocks.push({ code: "mandate-expired", reason: "mandate has expired" });
  }
  const approved = mandate.approvedPlatforms.some((item) => item.toLowerCase() === platform.toLowerCase());
  if (!approved) blocks.push({ code: "platform", reason: "platform is not on this mandate" });
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
  return blocks;
}
