import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { getAddress } from "viem";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import type { Mandate } from "../src/domain.js";
import { monthEpoch } from "../src/examples.js";
import { buildProposal } from "../src/proposal/build.js";

const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const payout = getAddress("0x00000000000000000000000000000000000000b2");
const other = getAddress("0x00000000000000000000000000000000000000b3");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

function mandate(minFeeBps: number, nav: bigint): Mandate {
  return {
    vault,
    partner: signer,
    signer,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: nav * 20n },
    minFeeBps,
    maxTenorSeconds: 400 * 86_400,
    concentrationCapBps: 5_000,
    expiresAt: now + 86_400,
    payoutTo: payout,
    idle: nav * 4n,
    totalAssets: nav * 4n,
  };
}

function book(nav: bigint, utilizationBps: number, days: number) {
  return {
    ...monthEpoch(now),
    navValue: nav,
    utilizationBps,
    epochSeconds: days * 86_400,
    limit: nav * 20n,
    reserveBalance: nav,
    bookAssets: nav * 20n,
    cashAvailable: nav * 20n,
    cashPerEpoch: nav * 20n,
    exposure: 0n,
  };
}

function built(nav: bigint, utilization: number, days: number, minFee: number, nonce: bigint, recipient = payout) {
  return buildProposal({
    input: book(nav, utilization, days),
    params: DEFAULT_PARAMS,
    mandate: mandate(minFee, nav),
    platform,
    recipient,
    chainId: 31337,
    nonce,
  });
}

describe("proposal properties", () => {
  it("keeps the digest, the payout, and the vault floor whenever it will sign", () => {
    let signed = 0;
    fc.assert(fc.property(
      fc.bigInt({ min: 1_000_000n, max: 50_000_000_000n }),
      fc.integer({ min: 0, max: 10_000 }),
      fc.integer({ min: 2, max: 40 }),
      fc.integer({ min: 0, max: DEFAULT_PARAMS.maxFeeBps }),
      fc.bigInt({ min: 1n, max: 1_000_000n }),
      (nav, utilization, days, minFee, nonce) => {
        const proposal = built(nav, utilization, days, minFee, nonce);
        expect(proposal.submittable).toBe(true);
        expect(proposal.blocks).toEqual([]);
        signed += 1;
        expect(proposal.partner.digest).toBe(proposal.digest);
        expect(proposal.partner.submitCalldata).toBe(proposal.calldata);
        expect(proposal.digest).toMatch(/^0x[0-9a-f]{64}$/);
        expect(proposal.calldata.startsWith("0xe7c1fee8")).toBe(true);
        expect(proposal.message.payout + proposal.message.fee).toBe(nav);
        expect(proposal.message.fee).toBeGreaterThanOrEqual((nav * BigInt(minFee)) / 10_000n);
        expect(proposal.message.feeBps).toBeGreaterThanOrEqual(Math.max(DEFAULT_PARAMS.minFeeBps, minFee));
        expect(proposal.message.feeBps).toBeLessThanOrEqual(DEFAULT_PARAMS.maxFeeBps);
        expect(proposal.message.expiresAt > BigInt(now)).toBe(true);
        expect(proposal.message.expiresAt <= BigInt(now + DEFAULT_PARAMS.proposalTtlSeconds)).toBe(true);
        expect(proposal.message.recipient).toBe(payout);
        expect(proposal.message.requestId).not.toBe(0n);
      },
    ), { numRuns: 100 });
    expect(signed).toBe(100);
  });

  it("changes the digest with the nonce and leaves quoteId alone", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1_000_000n, max: 20_000_000_000n }),
      fc.integer({ min: 0, max: 10_000 }),
      fc.bigInt({ min: 1n, max: 9_000n }),
      (nav, utilization, nonce) => {
        const first = built(nav, utilization, 30, 10, nonce);
        const second = built(nav, utilization, 30, 10, nonce + 1n);
        expect(first.message.quoteId).toBe(second.message.quoteId);
        expect(first.digest).not.toBe(second.digest);
        expect(first.message.fee).toBe(second.message.fee);
      },
    ), { numRuns: 50 });
  });

  it("does not cut the fee as utilization rises, and refuses a foreign recipient", () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1_000_000n, max: 20_000_000_000n }),
      fc.integer({ min: 0, max: 9_999 }),
      fc.integer({ min: 2, max: 40 }),
      (nav, lowUtil, days) => {
        const low = built(nav, lowUtil, days, 10, 1n);
        const high = built(nav, lowUtil + 1, days, 10, 1n);
        expect(low.submittable && high.submittable).toBe(true);
        expect(high.message.fee >= low.message.fee).toBe(true);
        const foreign = built(nav, lowUtil, days, 10, 1n, other);
        expect(foreign.submittable).toBe(false);
        expect(foreign.blocks.map((block) => block.code)).toContain("recipient");
      },
    ), { numRuns: 50 });
  });
});
