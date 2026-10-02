import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { applyKasuRead } from "../src/adapters/apply.js";
import { erc4626Abi, poolTokenAbi } from "../src/adapters/kasu/abi.js";
import { withdrawalId } from "../src/adapters/kasu/ids.js";
import { readKasu } from "../src/adapters/kasu/read.js";
import type { ContractReader } from "../src/adapters/reader.js";
import { weeklyClear } from "../src/examples.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { quoteExit } from "../src/quote.js";

const NOW = 1_700_000_000;
const SYSTEM = "0x00000000000000000000000000000000000000a1" as Address;
const PENDING = "0x00000000000000000000000000000000000000a2" as Address;
const TRANCHE = "0x00000000000000000000000000000000000000c1" as Address;
const OTHER = "0x00000000000000000000000000000000000000c2" as Address;
const LENDING_POOL = "0x00000000000000000000000000000000000000d1" as Address;
const OTHER_POOL = "0x00000000000000000000000000000000000000d2" as Address;
const ONE_TOKEN = 1_000_000n;
const EIGHTEEN = 10n ** 18n;

type Call = { address: Address; functionName: string; args?: readonly unknown[] };

function kasuReader(handlers: Record<string, (call: Call) => unknown>): { reader: ContractReader; calls: string[] } {
  const calls: string[] = [];
  const base: Record<string, (call: Call) => unknown> = {
    currentEpochNumber: () => 4n,
    epochDuration: () => 604_800n,
    clearingPeriodLength: () => 172_800n,
    epochStartTimestamp: () => BigInt(NOW - 2 * 86_400),
    isClearingTime: () => false,
    ...handlers,
  };
  const reader: ContractReader = {
    async readContract(args) {
      calls.push(args.functionName);
      const handler = base[args.functionName];
      if (!handler) throw new Error(`unread ${args.functionName}`);
      return handler(args);
    },
  };
  return { reader, calls };
}

function oneWithdrawal(id: bigint, tranche: Address, shares: bigint): Record<string, (call: Call) => unknown> {
  return {
    totalSupply: () => 1n,
    tokenByIndex: () => id,
    trancheWithdrawalNftDetails: () => [shares, tranche, 4n, 1, 0],
  };
}

describe("Kasu pool-token units", () => {
  it("prices a 6-decimal lending-pool token without a caller decimal count", async () => {
    const id = withdrawalId(1n, 1n);
    const { reader, calls } = kasuReader({
      ...oneWithdrawal(id, TRANCHE, ONE_TOKEN),
      asset: () => LENDING_POOL,
      decimals: () => 6,
      convertToAssets: () => ONE_TOKEN,
    });
    const seen = await readKasu(reader, { systemVariables: SYSTEM, pendingPool: PENDING });
    expect(erc4626Abi.map((row) => row.name)).toEqual(["asset", "convertToAssets"]);
    expect(poolTokenAbi[0]?.name).toBe("decimals");
    expect(calls).toContain("asset");
    expect(calls).toContain("decimals");
    expect(seen.queuedValue).toBe(ONE_TOKEN);
    expect(seen.queuedShares).toBe(ONE_TOKEN);
    expect(seen.poolDecimals).toBe(6);
    expect(seen.notes.some((note) => note.startsWith("pool-decimals:"))).toBe(false);
    const applied = applyKasuRead(weeklyClear(NOW), seen);
    expect(applied.queuedAhead).toBe(ONE_TOKEN);
    expect(applied.cashKnown).toBe(true);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.available).toBe(true);
    expect(quoted.blocks.map((item) => item.code)).toEqual([]);
    expect(quoted.navValue).toBe(weeklyClear(NOW).navValue);
    expect(quoted.payout + quoted.fee).toBe(quoted.navValue);
  });

  it("does not divide a 6-decimal pool amount by 10^12", async () => {
    const id = withdrawalId(1n, 1n);
    const { reader } = kasuReader({
      ...oneWithdrawal(id, TRANCHE, EIGHTEEN),
      asset: () => LENDING_POOL,
      decimals: () => 6n,
      convertToAssets: () => EIGHTEEN,
    });
    const seen = await readKasu(reader, { systemVariables: SYSTEM, pendingPool: PENDING });
    expect(seen.queuedValue).toBe(EIGHTEEN);
    expect(seen.poolDecimals).toBe(6);
    const applied = applyKasuRead(weeklyClear(NOW), seen);
    expect(applied.queuedAhead).toBe(EIGHTEEN);
    expect(applied.cashKnown).toBe(true);
  });

  it("refuses a pool whose decimals are not 6 and does not fund that amount", async () => {
    const id = withdrawalId(1n, 1n);
    const { reader, calls } = kasuReader({
      ...oneWithdrawal(id, TRANCHE, EIGHTEEN),
      asset: () => LENDING_POOL,
      decimals: () => 18,
      convertToAssets: () => EIGHTEEN,
    });
    const seen = await readKasu(reader, { systemVariables: SYSTEM, pendingPool: PENDING });
    expect(calls).not.toContain("convertToAssets");
    expect(seen.queuedValue).toBeNull();
    expect(seen.poolDecimals).toBeNull();
    expect(seen.notes).toContain(`pool-decimals:${TRANCHE}:18`);
    const applied = applyKasuRead({ ...weeklyClear(NOW), cashKnown: true }, seen);
    expect(applied.cashKnown).toBe(false);
    expect(applied.queuedAhead).toBe(0n);
    const quoted = quoteExit(applied, DEFAULT_PARAMS);
    expect(quoted.available).toBe(false);
    expect(quoted.payout).toBe(0n);
    expect(quoted.fee).toBe(0n);
    expect(quoted.navValue).toBe(weeklyClear(NOW).navValue);
    expect(quoted.blocks.map((item) => item.code)).toContain("illiquid");
    expect(quoted.assumption).toBe("liquidity-unknown");
  });

  it("drops the whole queue when a later tranche is not 6 decimals", async () => {
    const first = withdrawalId(1n, 1n);
    const second = withdrawalId(2n, 1n);
    const { reader, calls } = kasuReader({
      totalSupply: () => 2n,
      tokenByIndex: (call) => (call.args?.[0] === 0n ? first : second),
      trancheWithdrawalNftDetails: (call) => (
        call.args?.[0] === first ? [ONE_TOKEN, TRANCHE, 4n, 1, 0] : [EIGHTEEN, OTHER, 4n, 1, 0]
      ),
      asset: (call) => (call.address === TRANCHE ? LENDING_POOL : OTHER_POOL),
      decimals: (call) => (call.address === LENDING_POOL ? 6 : 18),
      convertToAssets: () => ONE_TOKEN,
    });
    const seen = await readKasu(reader, { systemVariables: SYSTEM, pendingPool: PENDING });
    expect(calls.filter((name) => name === "convertToAssets")).toHaveLength(1);
    expect(seen.queuedShares).toBe(ONE_TOKEN + EIGHTEEN);
    expect(seen.queuedValue).toBeNull();
    expect(seen.poolDecimals).toBeNull();
    expect(seen.notes).toContain(`pool-decimals:${OTHER}:18`);
    const quoted = quoteExit(applyKasuRead(weeklyClear(NOW), seen), DEFAULT_PARAMS);
    expect(quoted.available).toBe(false);
    expect(quoted.payout).toBe(0n);
  });

  it("refuses the queue when asset() cannot be read", async () => {
    const id = withdrawalId(1n, 1n);
    const { reader, calls } = kasuReader({
      ...oneWithdrawal(id, TRANCHE, ONE_TOKEN),
      asset: () => {
        throw new Error("no asset");
      },
    });
    const seen = await readKasu(reader, { systemVariables: SYSTEM, pendingPool: PENDING });
    expect(calls).not.toContain("decimals");
    expect(calls).not.toContain("convertToAssets");
    expect(seen.queuedValue).toBeNull();
    expect(seen.poolDecimals).toBeNull();
    expect(seen.notes).toContain(`unpriced-tranche:${TRANCHE}`);
    const quoted = quoteExit(applyKasuRead(weeklyClear(NOW), seen), DEFAULT_PARAMS);
    expect(quoted.payout).toBe(0n);
    expect(quoted.blocks.map((item) => item.code)).toContain("illiquid");
  });
});
