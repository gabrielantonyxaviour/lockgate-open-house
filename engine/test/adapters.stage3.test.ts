import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeFunctionResult, encodeFunctionResult, getAddress } from "viem";
import { z } from "zod";
import { applyKasuRead, applyMapleRead, applyUsdaiRead } from "../src/adapters/apply.js";
import { DEPLOYMENTS } from "../src/adapters/deployments.js";
import { kasuPendingAbi } from "../src/adapters/kasu/abi.js";
import { isDepositNft } from "../src/adapters/kasu/ids.js";
import { readKasu } from "../src/adapters/kasu/read.js";
import { mapleQueueAbi } from "../src/adapters/maple/abi.js";
import { readMaple } from "../src/adapters/maple/read.js";
import { named, type ContractReader } from "../src/adapters/reader.js";
import { stakedUsdaiAbi } from "../src/adapters/usdai/abi.js";
import { readUsdai } from "../src/adapters/usdai/read.js";
import { parseOrThrow } from "../src/domain.js";
import { mapleCovered, monthEpoch, weeklyClear } from "../src/examples.js";
import { parseJson } from "../src/json.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { quoteExit } from "../src/quote.js";

const DEPOSIT = 1461501637330902918203684832716283019655932543146n;
const EPOCH = 2_592_000;
const PAST_STAMP = 1_692_224_000;

const callSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  functionName: z.string().min(1).max(80),
  args: z.array(z.string().regex(/^[0-9]+$/)).max(8).optional(),
  result: z.unknown().optional(),
  error: z.string().min(1).max(120).optional(),
}).superRefine((row, ctx) => {
  if ((row.result !== undefined) === (row.error !== undefined)) {
    ctx.addIssue({ code: "custom", message: "call needs a result or an error" });
  }
});

const tapeSchema = z.object({
  platform: z.string().min(1).max(80),
  now: z.number().int().nonnegative(),
  calls: z.array(callSchema).min(1).max(64),
});

type Tape = z.infer<typeof tapeSchema>;

function load(name: string): Tape {
  const file = new URL(`../fixtures/adapters/${name}.json`, import.meta.url);
  return parseOrThrow(tapeSchema, parseJson(readFileSync(file, "utf8")));
}

function revive(value: unknown): unknown {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = revive(inner);
    return out;
  }
  return value;
}

function replay(tape: Tape): { reader: ContractReader; done: () => boolean } {
  let index = 0;
  const reader: ContractReader = {
    async readContract(args) {
      const next = tape.calls[index];
      index += 1;
      if (!next) throw new Error(`unexpected ${args.functionName}`);
      if (next.functionName !== args.functionName) {
        throw new Error(`expected ${next.functionName}, got ${args.functionName}`);
      }
      if (getAddress(next.address) !== getAddress(args.address)) {
        throw new Error(`expected ${next.functionName} at ${next.address}`);
      }
      const got = (args.args ?? []).map((item) => String(item)).join(",");
      if (got !== (next.args ?? []).join(",")) throw new Error(`args for ${args.functionName}`);
      if (next.error) throw new Error(next.error);
      return revive(next.result);
    },
  };
  return { reader, done: () => index === tape.calls.length };
}

function codes(quote: { blocks: { code: string }[] }): string[] {
  return quote.blocks.map((item) => item.code);
}

describe("stage 3 adapter fixtures", () => {
  it("keeps the Kasu clock, skips a deposit, and refuses known cash when a tranche is unpriced", async () => {
    const tape = load("kasu-partial");
    const played = replay(tape);
    const seen = await readKasu(played.reader, {
      systemVariables: DEPLOYMENTS.kasuBase.systemVariables,
      pendingPool: getAddress("0x00000000000000000000000000000000000000ab"),
    });
    expect(played.done()).toBe(true);
    expect(isDepositNft(DEPOSIT)).toBe(true);
    expect(seen.epochStart).toBe(1_600_000_000);
    expect(seen.epochStart).toBeLessThan(tape.now);
    expect(seen.epochSeconds).toBe(604_800);
    expect(seen.clearingSeconds).toBe(172_800);
    expect(seen.queuedShares).toBe(3_500_000n);
    expect(seen.queuedValue).toBeNull();
    expect(seen.truncated).toBe(false);
    expect(seen.notes).toContain("unpriced-tranche:0x00000000000000000000000000000000000000bb");
    const applied = applyKasuRead({ ...weeklyClear(tape.now), cashKnown: true }, seen);
    expect(applied.cashKnown).toBe(false);
    expect(applied.queuedAhead).toBe(0n);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.available).toBe(false);
    expect(codes(quoted)).toContain("illiquid");
    expect(quoted.assumption).toBe("liquidity-unknown");
  });

  it("does not price an 18-decimal Kasu pool token as USDG", async () => {
    const tape = load("kasu-foreign");
    const played = replay(tape);
    const seen = await readKasu(played.reader, {
      systemVariables: DEPLOYMENTS.kasuBase.systemVariables,
      pendingPool: getAddress("0x00000000000000000000000000000000000000ab"),
    });
    expect(played.done()).toBe(true);
    expect(tape.calls.some((row) => row.functionName === "convertToAssets")).toBe(false);
    expect(seen.queuedShares).toBe(1_000_000_000_000_000_000n);
    expect(seen.queuedValue).toBeNull();
    expect(seen.notes).toContain("pool-decimals:0x00000000000000000000000000000000000000aa:18");
    const applied = applyKasuRead({ ...weeklyClear(tape.now), cashKnown: true }, seen);
    expect(applied.cashKnown).toBe(false);
    expect(applied.queuedAhead).toBe(0n);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.available).toBe(false);
    expect(quoted.payout).toBe(0n);
    expect(quoted.fee).toBe(0n);
    expect(codes(quoted)).toContain("illiquid");
  });

  it("prices Maple shares after totalAssets fails and uses the 30-day unknown-cash wait", async () => {
    const tape = load("maple-partial");
    const played = replay(tape);
    const seen = await readMaple(played.reader, DEPLOYMENTS.mapleEthereumSyrupUsdc);
    expect(played.done()).toBe(true);
    expect(seen.queuedShares).toBe(3_000_000n);
    expect(seen.queuedValue).toBe(3_000_000n);
    expect(seen.totalAssets).toBeNull();
    expect(seen.cashKnown).toBe(false);
    expect(seen.truncated).toBe(false);
    expect(seen.notes).toContain("total-assets-unread");
    const covered = quoteExit(mapleCovered(tape.now), DEFAULT_PARAMS);
    expect(covered.assumption).toBe("maple-under-24h");
    expect(covered.secondsToClear).toBe(86_400);
    const applied = applyMapleRead(mapleCovered(tape.now), seen);
    expect(applied.cashKnown).toBe(false);
    expect(applied.truncated).toBe(false);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.assumption).toBe("maple-worst-case-30d");
    expect(quoted.secondsToClear).toBe(EPOCH);
    expect(quoted.available).toBe(true);
  });

  it("aborts a Maple scan when a later request cannot be read", async () => {
    const tape = load("maple-broken");
    const played = replay(tape);
    await expect(readMaple(played.reader, DEPLOYMENTS.mapleEthereumSyrupUsdc)).rejects.toThrow("missing request");
    expect(played.done()).toBe(true);
  });

  it("rolls a past sUSDai timestamp onto the next window and prices that clock", async () => {
    const tape = load("usdai-stale");
    const played = replay(tape);
    const seen = await readUsdai(played.reader, DEPLOYMENTS.usdaiArbitrum, tape.now);
    expect(played.done()).toBe(true);
    expect(seen.timestampWasPast).toBe(true);
    expect(seen.nextWindowAt).toBe(1_702_592_000);
    expect(seen.nextWindowAt).toBeGreaterThan(tape.now);
    expect(seen.queuedValue).toBe(2_000_000n);
    expect(seen.cashAvailable).toBe(1_000_000n);
    expect(seen.nav).toBe(5_000_000n);
    expect(seen.notes).toContain("epoch-timestamp-in-past");
    const applied = applyUsdaiRead(monthEpoch(tape.now), seen);
    expect(applied.epochStart).toBe(seen.nextWindowAt - seen.epochSeconds);
    expect(applied.epochStart).not.toBe(PAST_STAMP);
    expect(applied.navValue).toBe(5_000_000n);
    expect(applied.cashPerEpoch).toBe(1_000_000n);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.dueAt).toBe(1_718_144_000);
    expect(quoted.dueAt).toBeGreaterThan(tape.now);
    expect(quoted.dueAt).not.toBe(PAST_STAMP);
  });

  it("rolls a timestamp equal to now and leaves a timestamp one second ahead", async () => {
    const dueTape = load("usdai-due");
    const duePlay = replay(dueTape);
    const due = await readUsdai(duePlay.reader, DEPLOYMENTS.usdaiArbitrum, dueTape.now);
    expect(duePlay.done()).toBe(true);
    expect(due.timestampWasPast).toBe(true);
    expect(due.nextWindowAt).toBe(dueTape.now + EPOCH);
    const nextTape = load("usdai-next");
    const nextPlay = replay(nextTape);
    const next = await readUsdai(nextPlay.reader, DEPLOYMENTS.usdaiArbitrum, nextTape.now);
    expect(nextPlay.done()).toBe(true);
    expect(next.timestampWasPast).toBe(false);
    expect(next.nextWindowAt).toBe(nextTape.now + 1);
    expect(next.notes).not.toContain("epoch-timestamp-in-past");
    const quoted = quoteExit(applyUsdaiRead(monthEpoch(nextTape.now), next), DEFAULT_PARAMS);
    expect(quoted.dueAt).toBe(1_718_144_001);
    expect(quoted.dueAt).toBeGreaterThan(next.nextWindowAt);
  });

  it("does not keep the caller's cash per epoch when the redemption balance is zero", async () => {
    const tape = load("usdai-empty");
    const played = replay(tape);
    const seen = await readUsdai(played.reader, DEPLOYMENTS.usdaiArbitrum, tape.now);
    expect(played.done()).toBe(true);
    expect(seen.queuedValue).toBe(2_000_000n);
    expect(seen.cashAvailable).toBe(0n);
    const before = monthEpoch(tape.now);
    expect(before.cashPerEpoch).toBe(50_000_000_000n);
    const applied = applyUsdaiRead(before, seen);
    expect(applied.cashAvailable).toBe(0n);
    expect(applied.cashPerEpoch).toBe(0n);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.available).toBe(false);
    expect(codes(quoted)).toContain("illiquid");
  });

  it("reads pending, shares, and Kasu shares from their published indexes", () => {
    const info = load("usdai-stale").calls[0]?.result;
    expect(Array.isArray(info)).toBe(true);
    expect(named(info, "pending", 3)).toBe("2000000000000000000");
    expect(named(info, "pending", 0)).toBe("1");
    const infoData = encodeFunctionResult({
      abi: stakedUsdaiAbi,
      functionName: "redemptionQueueInfo",
      result: (info as string[]).map((item) => BigInt(item)) as [bigint, bigint, bigint, bigint, bigint],
    });
    const decodedInfo = decodeFunctionResult({
      abi: stakedUsdaiAbi,
      functionName: "redemptionQueueInfo",
      data: infoData,
    });
    expect(named(decodedInfo, "pending", 3)).toBe(2_000_000_000_000_000_000n);
    expect(named(decodedInfo, "index", 0)).toBe(1n);

    const queue = load("maple-partial").calls[0]?.result;
    expect(named(queue, "nextRequestId", 0)).toBe("10");
    expect(named(queue, "lastRequestId", 1)).toBe("11");
    expect(named(queue, "lastRequestId", 0)).toBe("10");
    const requests = load("maple-partial").calls[2]?.result;
    expect(named(requests, "shares", 1)).toBe("1000000");
    expect(named(requests, "owner", 0)).toBe("0x1111111111111111111111111111111111111111");
    const queueData = encodeFunctionResult({ abi: mapleQueueAbi, functionName: "queue", result: [10n, 11n] });
    const decodedQueue = decodeFunctionResult({ abi: mapleQueueAbi, functionName: "queue", data: queueData });
    expect(named(decodedQueue, "nextRequestId", 0)).toBe(10n);
    expect(named(decodedQueue, "lastRequestId", 1)).toBe(11n);

    const details = load("kasu-partial").calls.find((row) => row.functionName === "trancheWithdrawalNftDetails")?.result;
    expect(named(details, "sharesAmount", 0)).toBe("2000000");
    expect(named(details, "tranche", 1)).toBe("0x00000000000000000000000000000000000000aa");
    expect(named(details, "sharesAmount", 1)).not.toBe("2000000");
    const detailsData = encodeFunctionResult({
      abi: kasuPendingAbi,
      functionName: "trancheWithdrawalNftDetails",
      result: {
        sharesAmount: 2_000_000n,
        tranche: getAddress("0x00000000000000000000000000000000000000aa"),
        epochId: 121n,
        priority: 1,
        requestedFrom: 0,
      },
    });
    const decodedDetails = decodeFunctionResult({
      abi: kasuPendingAbi,
      functionName: "trancheWithdrawalNftDetails",
      data: detailsData,
    });
    expect(named(decodedDetails, "sharesAmount", 0)).toBe(2_000_000n);
    expect(String(named(decodedDetails, "tranche", 1)).toLowerCase()).toBe("0x00000000000000000000000000000000000000aa");
  });
});
