import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { getAddress } from "viem";
import { monthEpoch } from "../src/examples.js";
import { EngineError } from "../src/errors.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { guardProposal, proposalFingerprint, wallFromSeed } from "../src/proposal/determinism.js";
import type { Mandate } from "../src/domain.js";

const SEED = 20261002;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const payout = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

function mandate(now: number): Mandate {
  return {
    vault,
    partner: signer,
    signer,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: 1_000_000_000_000n },
    minFeeBps: 10,
    maxTenorSeconds: 400 * 86_400,
    concentrationCapBps: 5_000,
    expiresAt: now + 86_400,
    payoutTo: payout,
    idle: 500_000_000_000n,
    totalAssets: 1_000_000_000_000n,
  };
}

function args(now: number, nonce: bigint, nav: bigint, utilizationBps: number, days: number, seed = SEED) {
  return {
    input: {
      ...monthEpoch(now),
      navValue: nav,
      utilizationBps,
      epochSeconds: days * 86_400,
      limit: nav * 20n,
      reserveBalance: nav,
      bookAssets: nav * 20n,
      cashAvailable: nav * 20n,
      cashPerEpoch: nav * 20n,
    },
    params: DEFAULT_PARAMS,
    mandate: mandate(now),
    platform,
    recipient: payout,
    chainId: 31337,
    nonce,
    seed,
  };
}

function run(seed: number): string[] {
  const prints: string[] = [];
  fc.assert(fc.property(
    fc.bigInt({ min: 1_000_000n, max: 20_000_000_000n }),
    fc.integer({ min: 0, max: 10_000 }),
    fc.integer({ min: 2, max: 40 }),
    fc.bigInt({ min: 1n, max: 1_000_000n }),
    (nav, utilization, days, nonce) => {
      const built = guardProposal(args(1_700_000_000, nonce, nav, utilization, days, seed));
      expect(built.submittable).toBe(true);
      prints.push(proposalFingerprint(built));
    },
  ), { seed, numRuns: 30 });
  return prints;
}

describe("proposal determinism", () => {
  it("repeats one seed as the same proposal bytes", () => {
    const now = Date.now;
    Date.now = () => {
      throw new Error("wall clock");
    };
    try {
      const built = guardProposal(args(1_700_000_000, 4n, 10_000_000_000n, 0, 30));
      const again = guardProposal(args(1_700_000_000, 4n, 10_000_000_000n, 0, 30));
      expect(proposalFingerprint(built)).toBe(proposalFingerprint(again));
      expect(built.digest).toBe(again.digest);
      expect(built.calldata).toBe(again.calldata);
      expect(built.submittable).toBe(true);
      expect(wallFromSeed(SEED)).toBe(1_700_000_000 + SEED);
    } finally {
      Date.now = now;
    }
  });

  it("keeps the signed bytes and moves only the clock gate when the seed changes", () => {
    const shifted = 1_700_000_000 + 90_000;
    const early = guardProposal({ ...args(shifted, 4n, 10_000_000_000n, 0, 30), seed: 0 });
    const late = guardProposal({ ...args(shifted, 4n, 10_000_000_000n, 0, 30), seed: 200_000 });
    expect(early.blocks.map((block) => block.code)).toContain("clock");
    expect(early.submittable).toBe(false);
    expect(late.blocks.map((block) => block.code)).not.toContain("clock");
    expect(late.submittable).toBe(true);
    expect(early.digest).toBe(late.digest);
    expect(early.calldata).toBe(late.calldata);
  });

  it("replays a fast-check seed into the same fingerprint list", () => {
    expect(run(SEED)).toEqual(run(SEED));
    expect(() => wallFromSeed(-1)).toThrow(EngineError);
    expect(() => wallFromSeed(1.5)).toThrow(EngineError);
  });
});
