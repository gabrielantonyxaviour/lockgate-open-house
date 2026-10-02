import { describe, expect, it } from "vitest";
import { decodeFunctionResult, encodeFunctionResult, getAddress } from "viem";
import { DEPLOYMENTS } from "../src/adapters/deployments.js";
import { isDepositNft, withdrawalId } from "../src/adapters/kasu/ids.js";
import { kasuPendingAbi, kasuSystemAbi } from "../src/adapters/kasu/abi.js";
import { readKasu } from "../src/adapters/kasu/read.js";
import { maplePoolAbi, mapleQueueAbi } from "../src/adapters/maple/abi.js";
import { readMaple } from "../src/adapters/maple/read.js";
import { stakedUsdaiAbi } from "../src/adapters/usdai/abi.js";
import { readUsdai } from "../src/adapters/usdai/read.js";
import { erc4626Abi } from "../src/adapters/kasu/abi.js";
import { erc20Abi } from "../src/adapters/maple/abi.js";
import type { ContractReader } from "../src/adapters/reader.js";

const tranche = getAddress("0x00000000000000000000000000000000000000aa");
const trancheInt = BigInt(tranche);

function reader(handlers: Record<string, (args?: readonly unknown[]) => unknown>): ContractReader {
  return {
    async readContract({ functionName, args }) {
      const handler = handlers[functionName];
      if (!handler) throw new Error(`unexpected ${functionName}`);
      return handler(args);
    },
  };
}

describe("live adapters", () => {
  it("keeps the published deployment addresses", () => {
    expect(DEPLOYMENTS.kasuBase.systemVariables).toBe("0x193Bb02A24F5562b58fEB86550e6f09Bb6c41f69");
    expect(DEPLOYMENTS.mapleEthereumSyrupUsdc.withdrawalManager).toBe("0x1bc47a0Dd0FdaB96E9eF982fdf1F34DC6207cfE3");
    expect(DEPLOYMENTS.mapleSepoliaSyrupUsdc.pool).toBe("0x2d8D21FeE98d060655729eFD7b14bc432C375aC1");
    expect(DEPLOYMENTS.usdaiArbitrum.staked).toBe("0x0B2b2B2076d95dda7817e785989fE353fe955ef9");
    expect(DEPLOYMENTS.usdaiArbitrum.asset).toBe("0x0A1a1A107E45b7Ced86833863f482BC5f4ed82EF");
  });

  it("splits Kasu deposit and withdrawal ids the way UserRequestIds does", () => {
    const deposit = trancheInt | (4n << 160n);
    const withdrawal = withdrawalId(trancheInt, 4n);
    expect(isDepositNft(deposit)).toBe(true);
    expect(isDepositNft(withdrawal)).toBe(false);
  });

  it("round-trips the Maple, Kasu, and sUSDai views the readers call", () => {
    const queue = encodeFunctionResult({ abi: mapleQueueAbi, functionName: "queue", result: [18553n, 18552n] });
    expect(decodeFunctionResult({ abi: mapleQueueAbi, functionName: "queue", data: queue })).toMatchObject([18553n, 18552n]);
    const clock = encodeFunctionResult({ abi: kasuSystemAbi, functionName: "epochDuration", result: 604800n });
    expect(decodeFunctionResult({ abi: kasuSystemAbi, functionName: "epochDuration", data: clock })).toBe(604800n);
    const info = encodeFunctionResult({
      abi: stakedUsdaiAbi,
      functionName: "redemptionQueueInfo",
      result: [1n, 2n, 3n, 4n, 5n],
    });
    expect(decodeFunctionResult({ abi: stakedUsdaiAbi, functionName: "redemptionQueueInfo", data: info })[3]).toBe(4n);
  });

  it("sums Kasu withdrawal shares and skips deposit NFTs", async () => {
    const withdrawal = withdrawalId(trancheInt, 1n);
    const deposit = trancheInt | (1n << 160n);
    const seen = await readKasu(reader({
      currentEpochNumber: () => 121n,
      epochDuration: () => 604800n,
      clearingPeriodLength: () => 172800n,
      epochStartTimestamp: () => 1_700_000_000n,
      isClearingTime: () => false,
      totalSupply: () => 2n,
      tokenByIndex: (args) => (args?.[0] === 0n ? deposit : withdrawal),
      trancheWithdrawalNftDetails: () => ({
        sharesAmount: 2_000_000n,
        tranche,
        epochId: 121,
        priority: 1,
        requestedFrom: 0,
      }),
      asset: () => getAddress("0x00000000000000000000000000000000000000d1"),
      decimals: () => 6,
      convertToAssets: () => 2_000_000n,
    }), {
      systemVariables: DEPLOYMENTS.kasuBase.systemVariables,
      pendingPool: getAddress("0x00000000000000000000000000000000000000ab"),
    });
    expect(seen.epochSeconds).toBe(604_800);
    expect(seen.clearingSeconds).toBe(172_800);
    expect(seen.queuedShares).toBe(2_000_000n);
    expect(seen.queuedValue).toBe(2_000_000n);
    expect(seen.truncated).toBe(false);
    expect(erc4626Abi.map((item) => item.name)).toEqual(["asset", "convertToAssets"]);
  });

  it("does not invent Maple cash, and marks a long queue truncated", async () => {
    const empty = await readMaple(reader({
      queue: () => ({ nextRequestId: 18553n, lastRequestId: 18552n }),
      decimals: () => 6,
      convertToExitAssets: () => 0n,
      totalAssets: () => 1_000_000n,
    }), {
      ...DEPLOYMENTS.mapleEthereumSyrupUsdc,
      maxScan: 10,
    });
    expect(empty.queuedValue).toBe(0n);
    expect(empty.cashKnown).toBe(false);
    const wide = await readMaple(reader({
      queue: () => [1n, 50n],
      decimals: () => 6,
      totalAssets: () => 1n,
    }), { ...DEPLOYMENTS.mapleSepoliaSyrupUsdc, maxScan: 2 });
    expect(wide.truncated).toBe(true);
    expect(wide.queuedValue).toBeNull();
    expect(maplePoolAbi.map((item) => item.name)).toEqual(["convertToExitAssets", "totalAssets"]);
  });

  it("converts an sUSDai queue into 6-decimal cash and a future window", async () => {
    const now = 1_790_000_000;
    const seen = await readUsdai(reader({
      redemptionQueueInfo: () => ({ index: 1n, head: 1n, tail: 1n, pending: 2n * 10n ** 18n, balance: 10n ** 18n }),
      redemptionSharePrice: () => 10n ** 18n,
      nav: () => 5n * 10n ** 18n,
      redemptionTimestamp: () => BigInt(now + 86_400),
      decimals: () => 18,
    }), { ...DEPLOYMENTS.usdaiArbitrum }, now);
    expect(seen.queuedValue).toBe(2_000_000n);
    expect(seen.cashAvailable).toBe(1_000_000n);
    expect(seen.nextWindowAt).toBe(now + 86_400);
    expect(seen.timestampWasPast).toBe(false);
    expect(erc20Abi.map((item) => item.name)).toEqual(["decimals"]);
    expect(kasuPendingAbi.map((item) => item.name)).toEqual([
      "totalSupply",
      "tokenByIndex",
      "trancheWithdrawalNftDetails",
    ]);
  });
});
