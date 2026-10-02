import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { EngineError } from "../src/errors.js";
import { monthEpoch } from "../src/examples.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { mandateBlocks } from "../src/proposal/mandate.js";
import { quoteExit } from "../src/quote.js";

const DAY = 86_400;
const WALL = 1_700_000_000;
const U = 1_000_000n;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");

function mandate(now: number) {
  return {
    vault,
    partner: vault,
    signer: vault,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: 100_000n * U },
    minFeeBps: 10,
    maxTenorSeconds: 40 * DAY,
    concentrationCapBps: 5_000,
    expiresAt: now + 40 * DAY,
    payoutTo: recipient,
    idle: 50_000n * U,
    totalAssets: 100_000n * U,
  };
}

describe("quote clock slack", () => {
  it("treats a NAV timestamp one day ahead of this machine as fresh", () => {
    const now = WALL + DAY;
    const ahead = { ...monthEpoch(now), navUpdatedAt: now - 60 };
    expect(() => quoteExit({ ...ahead, now: WALL }, DEFAULT_PARAMS)).toThrow(EngineError);
    try {
      quoteExit({ ...ahead, now: WALL }, DEFAULT_PARAMS);
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).message).toBe("NAV timestamp is in the future");
    }
    const quote = quoteExit(ahead, DEFAULT_PARAMS);
    expect(quote.available).toBe(true);
    expect(quote.blocks).toEqual([]);
    expect(mandateBlocks(quote, ahead, mandate(now), platform, recipient, WALL)).toEqual([]);
    const tooFar = { ...monthEpoch(WALL + DAY + 1), navUpdatedAt: WALL + DAY };
    const far = quoteExit(tooFar, DEFAULT_PARAMS);
    expect(mandateBlocks(far, tooFar, mandate(WALL + DAY + 1), platform, recipient, WALL).map((block) => block.code)).toContain("clock");
  });

  it("accepts an oracle print that is in the future on this machine when the quote clock moves with it", () => {
    const now = WALL + DAY;
    const peg = {
      enabled: true,
      priceE8: 100_000_000n,
      updatedAt: now - 60,
      minPriceE8: 99_000_000n,
      maxOracleAge: 3_600,
    };
    const ahead = { ...monthEpoch(now), peg };
    expect(quoteExit(ahead, DEFAULT_PARAMS).available).toBe(true);
    const honest = quoteExit({ ...ahead, now: WALL, navUpdatedAt: WALL - 3_600 }, DEFAULT_PARAMS);
    expect(honest.available).toBe(false);
    expect(honest.blocks.map((block) => block.code)).toContain("stale-oracle");
  });
});
