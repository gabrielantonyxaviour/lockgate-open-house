import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { applyKasuRead } from "../src/adapters/apply.js";
import { DEPLOYMENTS } from "../src/adapters/deployments.js";
import { withdrawalId } from "../src/adapters/kasu/ids.js";
import { readKasu } from "../src/adapters/kasu/read.js";
import { readMaple } from "../src/adapters/maple/read.js";
import { MAX_QUEUE_SCAN, scanBound, type ContractReader } from "../src/adapters/reader.js";
import { weeklyClear } from "../src/examples.js";
import { EngineError } from "../src/errors.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { buildProposal } from "../src/proposal/build.js";
import { quoteExit } from "../src/quote.js";

const NOW = 1_700_000_000;
const SHARE = 1_000_000n;
const OWNER = getAddress("0x00000000000000000000000000000000000000b2");
const TRANCHE = getAddress("0x00000000000000000000000000000000000000aa");
const POOL = getAddress("0x00000000000000000000000000000000000000d1");
const PLATFORM = getAddress("0x00000000000000000000000000000000000000b1");
const RECIPIENT = getAddress("0x00000000000000000000000000000000000000b2");
const VAULT = getAddress("0x00000000000000000000000000000000000000c1");
const U = 1_000_000n;

function indexes(count: number): bigint[] {
  return Array.from({ length: count }, (_, index) => BigInt(index));
}

function prefixSum(count: bigint): bigint {
  return (count * (count + 1n) / 2n) * SHARE;
}

async function drain<T>(run: () => Promise<T>): Promise<T> {
  let settled = false;
  const pending = run().finally(() => {
    settled = true;
  });
  for (let step = 0; step < 4_000 && !settled; step++) {
    await vi.advanceTimersByTimeAsync(100);
  }
  if (!settled) throw new Error("queue scan did not finish under the fake clock");
  return pending;
}

function mapleReader(next: bigint, last: bigint, requests: bigint[], converted: bigint[]): ContractReader {
  return {
    async readContract({ functionName, args }) {
      if (functionName === "queue") return [next, last];
      if (functionName === "decimals") return 6;
      if (functionName === "totalAssets") return 1n;
      if (functionName === "requests") {
        const id = args?.[0];
        if (typeof id !== "bigint") throw new Error("request id");
        requests.push(id);
        return [OWNER, SHARE];
      }
      if (functionName === "convertToExitAssets") {
        const shares = args?.[0];
        if (typeof shares !== "bigint") throw new Error("shares");
        converted.push(shares);
        return shares;
      }
      throw new Error(functionName);
    },
  };
}

async function maple(next: bigint, last: bigint, maxScan?: number) {
  const requests: bigint[] = [];
  const converted: bigint[] = [];
  const cfg = { ...DEPLOYMENTS.mapleSepoliaSyrupUsdc };
  const result = await drain(() => readMaple(
    mapleReader(next, last, requests, converted),
    maxScan === undefined ? cfg : { ...cfg, maxScan },
  ));
  return { result, requests, converted };
}

function kasuReader(supply: bigint, indexesSeen: bigint[], converted: bigint[]): ContractReader {
  const sharesOf = new Map<bigint, bigint>();
  return {
    async readContract({ functionName, args }) {
      if (functionName === "currentEpochNumber") return 121n;
      if (functionName === "epochDuration") return 604_800n;
      if (functionName === "clearingPeriodLength") return 172_800n;
      if (functionName === "epochStartTimestamp") return BigInt(NOW);
      if (functionName === "isClearingTime") return false;
      if (functionName === "totalSupply") return supply;
      if (functionName === "tokenByIndex") {
        const index = args?.[0];
        if (typeof index !== "bigint") throw new Error("index");
        indexesSeen.push(index);
        const id = withdrawalId(BigInt(TRANCHE), index + 1n);
        sharesOf.set(id, (index + 1n) * SHARE);
        return id;
      }
      if (functionName === "trancheWithdrawalNftDetails") {
        const id = args?.[0];
        if (typeof id !== "bigint") throw new Error("nft");
        const shares = sharesOf.get(id);
        if (shares === undefined) throw new Error("unknown nft");
        return { sharesAmount: shares, tranche: TRANCHE };
      }
      if (functionName === "asset") return POOL;
      if (functionName === "decimals") return 6;
      if (functionName === "convertToAssets") {
        const shares = args?.[0];
        if (typeof shares !== "bigint") throw new Error("assets");
        converted.push(shares);
        return shares;
      }
      throw new Error(functionName);
    },
  };
}

async function kasu(supply: bigint, maxScan?: number) {
  const indexesSeen: bigint[] = [];
  const converted: bigint[] = [];
  const cfg = {
    systemVariables: DEPLOYMENTS.kasuBase.systemVariables,
    pendingPool: getAddress("0x00000000000000000000000000000000000000ab"),
  };
  const result = await drain(() => readKasu(
    kasuReader(supply, indexesSeen, converted),
    maxScan === undefined ? cfg : { ...cfg, maxScan },
  ));
  return { result, indexesSeen, converted };
}

describe("queue scan bound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to 100 and clamps every larger request at 256", () => {
    expect(scanBound(undefined)).toBe(100);
    expect(scanBound(100)).toBe(100);
    expect(scanBound(256)).toBe(256);
    expect(scanBound(257)).toBe(MAX_QUEUE_SCAN);
    expect(scanBound(1_000_000)).toBe(MAX_QUEUE_SCAN);
    expect(MAX_QUEUE_SCAN).toBe(256);
    expect(() => scanBound(0)).toThrow(EngineError);
    expect(() => scanBound(1.5)).toThrow(/maxScan must be a positive integer/);
  });

  it("reads a 100-id Maple queue by default and never reads the 101st", async () => {
    const full = await maple(1n, 100n);
    expect(full.result.truncated).toBe(false);
    expect(full.requests).toEqual(indexes(100).map((index) => index + 1n));
    expect(full.requests).not.toContain(101n);
    expect(full.result.queuedValue).toBe(100n * SHARE);
    expect(full.converted).toEqual([100n * SHARE]);

    const over = await maple(1n, 101n);
    expect(over.result.truncated).toBe(true);
    expect(over.result.queuedValue).toBeNull();
    expect(over.requests).toEqual([]);
    expect(over.converted).toEqual([]);
    expect(over.result.notes).toContain("scan-truncated");
  });

  it("clamps a Maple scan at 256 and does not read the 257th id", async () => {
    const full = await maple(1n, 256n, 1_000_000);
    expect(full.result.truncated).toBe(false);
    expect(full.requests).toEqual(indexes(256).map((index) => index + 1n));
    expect(full.requests).not.toContain(257n);
    expect(full.result.queuedValue).toBe(256n * SHARE);

    const over = await maple(1n, 257n, 1_000_000);
    expect(over.result.truncated).toBe(true);
    expect(over.result.queuedValue).toBeNull();
    expect(over.requests).toEqual([]);
    expect(over.converted).toEqual([]);
  });

  it("prices only the Kasu prefix inside the default of 100", async () => {
    const over = await kasu(101n);
    const tail = 101n * SHARE;
    expect(over.result.truncated).toBe(true);
    expect(over.indexesSeen).toEqual(indexes(100));
    expect(over.indexesSeen).not.toContain(100n);
    expect(over.result.queuedValue).toBe(prefixSum(100n));
    expect(over.converted).toEqual([prefixSum(100n)]);
    expect(over.result.queuedValue).not.toBe(prefixSum(100n) + tail);

    const full = await kasu(100n);
    expect(full.result.truncated).toBe(false);
    expect(full.indexesSeen).toEqual(indexes(100));
    expect(full.result.queuedValue).toBe(prefixSum(100n));
  });

  it("prices only the first 256 Kasu entries when the caller asks for more", async () => {
    const over = await kasu(257n, 1_000_000);
    expect(over.result.truncated).toBe(true);
    expect(over.indexesSeen).toEqual(indexes(256));
    expect(over.indexesSeen).not.toContain(256n);
    expect(over.result.queuedValue).toBe(prefixSum(256n));
    expect(over.converted).toEqual([prefixSum(256n)]);
  });

  it("will not sign a truncated Kasu prefix even with allowPartialScan", async () => {
    const over = await kasu(101n);
    const applied = applyKasuRead({ ...weeklyClear(NOW), allowPartialScan: true }, over.result);
    expect(applied.truncated).toBe(true);
    expect(applied.queuedAhead).toBe(prefixSum(100n));
    expect(applied.queuedAhead).not.toBe(prefixSum(101n));
    expect(applied.cashKnown).toBe(false);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.available).toBe(false);
    expect(quoted.blocks.map((block) => block.code)).toContain("illiquid");
    expect(quoted.blocks.map((block) => block.code)).not.toContain("scan-truncated");
    const proposal = buildProposal({
      input: applied,
      params: DEFAULT_PARAMS,
      mandate: {
        vault: VAULT,
        partner: VAULT,
        signer: VAULT,
        approvedPlatforms: [PLATFORM],
        platformLimits: { [PLATFORM]: 100_000n * U },
        minFeeBps: 10,
        maxTenorSeconds: 40 * 86_400,
        concentrationCapBps: 5_000,
        expiresAt: NOW + 86_400,
        payoutTo: RECIPIENT,
        idle: 50_000n * U,
        totalAssets: 100_000n * U,
      },
      platform: PLATFORM,
      recipient: RECIPIENT,
      chainId: 31337,
      nonce: 4n,
    });
    expect(proposal.submittable).toBe(false);
    expect(proposal.blocks.map((block) => block.code)).toContain("scan-truncated");
  });
});
