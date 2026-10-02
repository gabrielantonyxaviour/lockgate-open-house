import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { getAddress } from "viem";
import { seasonedHistory } from "../src/examples.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { buildProposal, type BuiltProposal } from "../src/proposal/build.js";
import type { Mandate, QueueKind, QuoteInput } from "../src/domain.js";

const NOW = 1_700_000_000;
const DAY = 86_400;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const payout = getAddress("0x00000000000000000000000000000000000000b2");
const stranger = getAddress("0x00000000000000000000000000000000000000b3");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

const BREACHES = [
  "none",
  "platform-limit",
  "tenor",
  "concentration",
  "idle",
  "vault",
  "paused",
  "min-fee",
  "unapproved",
] as const;

type Breach = (typeof BREACHES)[number];

type Sample = {
  kind: QueueKind;
  nav: bigint;
  exposure: bigint;
  queuedAhead: bigint;
  utilizationBps: number;
  days: number;
  reserveBps: number;
  minFeeBps: number;
  breach: Breach;
  nonce: bigint;
};

const sample = fc.record({
  kind: fc.constantFrom<QueueKind>("weekly-cycle", "epoch", "quarterly-gated", "fifo-open"),
  nav: fc.bigInt({ min: 1_000_000n, max: 50_000_000_000n }),
  exposure: fc.bigInt({ min: 0n, max: 50_000_000_000n }),
  queuedAhead: fc.bigInt({ min: 0n, max: 50_000_000_000n }),
  utilizationBps: fc.integer({ min: 0, max: 10_000 }),
  days: fc.integer({ min: 2, max: 120 }),
  reserveBps: fc.integer({ min: 500, max: 1_000 }),
  minFeeBps: fc.integer({ min: 0, max: 400 }),
  breach: fc.constantFrom(...BREACHES),
  nonce: fc.bigInt({ min: 1n, max: 1_000_000n }),
});

function queue(row: Sample): QuoteInput {
  const seconds = row.days * DAY;
  const exposureAfter = row.exposure + row.nav;
  const input: QuoteInput = {
    platformId: "fuzz-queue",
    kind: row.kind,
    now: NOW,
    navValue: row.nav,
    queuedAhead: row.queuedAhead,
    cashAvailable: row.queuedAhead + row.nav,
    cashPerEpoch: row.queuedAhead + row.nav,
    cashKnown: true,
    gated: false,
    navUpdatedAt: NOW - 3_600,
    reserveBalance: exposureAfter,
    reserveBps: row.reserveBps,
    exposure: row.exposure,
    limit: exposureAfter * 4n,
    bookAssets: exposureAfter * 8n,
    utilizationBps: row.utilizationBps,
    repayment: seasonedHistory(),
    requestId: row.nonce,
    epochStart: NOW,
    requestedAt: NOW,
  };
  if (row.kind === "weekly-cycle") {
    return { ...input, epochSeconds: seconds, clearingSeconds: Math.floor(seconds / 4) };
  }
  if (row.kind === "epoch") return { ...input, epochSeconds: seconds, cutoffSeconds: DAY };
  if (row.kind === "quarterly-gated") return { ...input, windowSeconds: seconds };
  return { ...input, coveredWaitSeconds: DAY, worstCaseSeconds: 30 * DAY };
}

function mandate(row: Sample, breach: Breach): Mandate {
  const exposureAfter = row.exposure + row.nav;
  const tightVault = breach === "vault";
  const tightBook = breach === "concentration";
  return {
    vault,
    partner: signer,
    signer,
    approvedPlatforms: breach === "unapproved" ? [stranger] : [platform],
    platformLimits: {
      [platform]: breach === "platform-limit" ? exposureAfter - 1n : exposureAfter,
    },
    minFeeBps: breach === "min-fee" ? 9_000 : row.minFeeBps,
    maxTenorSeconds: breach === "tenor" ? 1 : 400 * DAY,
    concentrationCapBps: tightBook ? 1 : 5_000,
    expiresAt: NOW + DAY,
    payoutTo: payout,
    paused: breach === "paused",
    idle: breach === "idle" ? 0n : row.nav,
    totalAssets: tightVault ? row.nav : exposureAfter * (tightBook ? 20_000n : 8n),
  };
}

function propose(row: Sample, breach: Breach): BuiltProposal {
  return buildProposal({
    input: queue(row),
    params: DEFAULT_PARAMS,
    mandate: mandate(row, breach),
    platform,
    recipient: payout,
    chainId: 31337,
    nonce: row.nonce,
  });
}

function assertInside(built: BuiltProposal): void {
  const { quote, input, mandate: terms, message } = built;
  const cap = terms.platformLimits[platform];
  const book = input.bookAssets > quote.exposureAfter ? input.bookAssets : quote.exposureAfter;
  const bps = book === 0n ? 10_000 : Number((quote.exposureAfter * 10_000n) / book);
  expect(cap).toBeDefined();
  expect(terms.idle).toBeDefined();
  expect(terms.totalAssets).toBeDefined();
  const vaultCap = (terms.totalAssets! * BigInt(terms.concentrationCapBps)) / 10_000n;
  expect(quote.exposureAfter).toBe(input.exposure + input.navValue);
  expect(message.navValue).toBe(quote.navValue);
  expect(message.payout + message.fee).toBe(message.navValue);
  expect(quote.exposureAfter <= cap!).toBe(true);
  expect(quote.secondsToClear).toBeLessThanOrEqual(terms.maxTenorSeconds);
  expect(Number(message.dueAt) - input.now).toBeLessThanOrEqual(terms.maxTenorSeconds);
  expect(bps).toBeLessThanOrEqual(terms.concentrationCapBps);
  expect(message.payout <= terms.idle!).toBe(true);
  expect(message.navValue <= vaultCap).toBe(true);
  expect(quote.exposureAfter <= vaultCap).toBe(true);
  expect(message.fee >= (message.navValue * BigInt(terms.minFeeBps)) / 10_000n).toBe(true);
  expect(message.feeBps).toBeGreaterThanOrEqual(terms.minFeeBps);
  expect(message.feeBps).toBeLessThanOrEqual(DEFAULT_PARAMS.maxFeeBps);
  expect(message.expiresAt <= BigInt(terms.expiresAt)).toBe(true);
  expect(message.expiresAt > BigInt(input.now)).toBe(true);
  expect(terms.paused ?? false).toBe(false);
  expect(terms.approvedPlatforms).toContain(platform);
  expect(message.recipient).toBe(terms.payoutTo);
  expect(message.requestId).not.toBe(0n);
}

const BLOCK: Record<Exclude<Breach, "none" | "idle">, string> = {
  "platform-limit": "platform-limit",
  tenor: "tenor",
  concentration: "concentration",
  vault: "vault-concentration",
  paused: "paused",
  "min-fee": "mandate-min",
  unapproved: "platform",
};

describe("mandate limits on random queues", () => {
  it("never signs a proposal that exceeds the mandate", () => {
    let signed = 0;
    fc.assert(fc.property(sample, (row) => {
      const clean = propose(row, "none");
      if (clean.submittable) {
        signed += 1;
        assertInside(clean);
      }
      if (row.breach === "none") return;
      const breached = propose(row, row.breach);
      expect(breached.submittable).toBe(false);
      if (row.breach === "idle") {
        if (clean.submittable) expect(breached.blocks.map((block) => block.code)).toContain("cash");
        return;
      }
      expect(breached.blocks.map((block) => block.code)).toContain(BLOCK[row.breach]);
    }), { numRuns: 100 });
    expect(signed).toBe(100);
  });
});
