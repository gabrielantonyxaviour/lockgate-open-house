import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAddress, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEPLOYMENTS } from "../src/adapters/deployments.js";
import { withdrawalId } from "../src/adapters/kasu/ids.js";
import { readKasu } from "../src/adapters/kasu/read.js";
import { readMaple } from "../src/adapters/maple/read.js";
import type { ContractReader } from "../src/adapters/reader.js";
import { readUsdai } from "../src/adapters/usdai/read.js";
import { run } from "../src/cli.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import type { Mandate } from "../src/domain.js";
import { monthEpoch } from "../src/examples.js";
import { encodeJson } from "../src/json.js";
import { buildProposal } from "../src/proposal/build.js";
import { filePartnerProposal } from "../src/proposal/partner.js";
import { signBuiltProposal } from "../src/proposal/sign.js";
import { vaultGuards, type VaultFacts } from "../src/proposal/vaultread.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const U = 1_000_000n;
const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");
const tranche = getAddress("0x00000000000000000000000000000000000000aa");
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

function mandate(): Mandate {
  return {
    vault,
    partner: signer,
    signer,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: 100_000n * U },
    minFeeBps: 10,
    maxTenorSeconds: 40 * 86_400,
    concentrationCapBps: 5_000,
    expiresAt: now + 86_400,
    payoutTo: recipient,
    idle: 50_000n * U,
    totalAssets: 100_000n * U,
  };
}

function propose(nonce: bigint) {
  return buildProposal({
    input: monthEpoch(now),
    params: DEFAULT_PARAMS,
    mandate: mandate(),
    platform,
    recipient,
    chainId: 31337,
    nonce,
  });
}

function reader(handlers: Record<string, () => unknown>): ContractReader {
  return {
    async readContract({ functionName }) {
      const handler = handlers[functionName];
      if (!handler) throw new Error(`rpc ${functionName}`);
      return handler();
    },
  };
}

const kasu = {
  systemVariables: DEPLOYMENTS.kasuBase.systemVariables,
  pendingPool: getAddress("0x00000000000000000000000000000000000000ab"),
};

describe("adapter and rpc failures", () => {
  it("does not invent a price for a missing tranche, clock, or Maple asset view", async () => {
    const unpriced = await readKasu(reader({
      currentEpochNumber: () => 1n,
      epochDuration: () => 604800n,
      clearingPeriodLength: () => 172800n,
      epochStartTimestamp: () => BigInt(now),
      isClearingTime: () => false,
      totalSupply: () => 1n,
      tokenByIndex: () => withdrawalId(BigInt(tranche), 1n),
      trancheWithdrawalNftDetails: () => ({ sharesAmount: 1n, tranche }),
      asset: () => getAddress("0x00000000000000000000000000000000000000d1"),
      decimals: () => 6,
      convertToAssets: () => {
        throw new Error("missing convert");
      },
    }), kasu);
    expect(unpriced.queuedValue).toBeNull();
    expect(unpriced.notes.some((note) => note.startsWith("unpriced-tranche:"))).toBe(true);
    await expect(readKasu(reader({
      currentEpochNumber: () => 1n,
      epochDuration: () => 2n ** 60n,
      clearingPeriodLength: () => 1n,
      epochStartTimestamp: () => 1n,
      isClearingTime: () => false,
      totalSupply: () => 0n,
    }), kasu)).rejects.toMatchObject({ code: "rpc" });
    const maple = await readMaple(reader({
      queue: () => ({ nextRequestId: 2n, lastRequestId: 1n }),
      decimals: () => 6,
      totalAssets: () => {
        throw new Error("missing assets");
      },
    }), { ...DEPLOYMENTS.mapleEthereumSyrupUsdc, maxScan: 4 });
    expect(maple.cashKnown).toBe(false);
    expect(maple.queuedValue).toBe(0n);
    expect(maple.totalAssets).toBeNull();
    expect(maple.notes).toContain("total-assets-unread");
  });

  it("rolls a stale sUSDai timestamp forward and rejects an overflowing one", async () => {
    const epoch = 2_592_000;
    const stale = await readUsdai(reader({
      redemptionQueueInfo: () => ({ pending: 0n, balance: 0n }),
      redemptionSharePrice: () => 10n ** 18n,
      nav: () => 0n,
      redemptionTimestamp: () => BigInt(now - 3 * epoch),
      decimals: () => 6,
    }), { ...DEPLOYMENTS.usdaiArbitrum, epochSeconds: epoch }, now);
    expect(stale.timestampWasPast).toBe(true);
    expect(stale.nextWindowAt).toBe(now + epoch);
    expect(stale.notes).toContain("epoch-timestamp-in-past");
    await expect(readUsdai(reader({
      redemptionQueueInfo: () => ({ pending: 0n, balance: 0n }),
      redemptionSharePrice: () => 1n,
      nav: () => 0n,
      redemptionTimestamp: () => 2n ** 60n,
      decimals: () => 6,
    }), DEPLOYMENTS.usdaiArbitrum, now)).rejects.toMatchObject({ code: "rpc" });
  });

  it("propagates an RPC rejection from each reader, the vault guard, and propose", async () => {
    const down: ContractReader = { readContract: async () => { throw new Error("rpc down"); } };
    await expect(readKasu(down, kasu)).rejects.toThrow("rpc down");
    await expect(readMaple(down, DEPLOYMENTS.mapleEthereumSyrupUsdc)).rejects.toThrow("rpc down");
    await expect(readUsdai(down, DEPLOYMENTS.usdaiArbitrum, now)).rejects.toThrow("rpc down");
    const dead = { getChainId: async () => { throw new Error("rpc down"); } } as unknown as PublicClient;
    await expect(vaultGuards(dead, {
      chainId: 31337,
      mandate: mandate(),
      platform,
      message: propose(81n).message,
    })).rejects.toThrow("rpc down");
    const dir = mkdtempSync(join(tmpdir(), "lockgate-rpc-"));
    const file = join(dir, "propose.json");
    writeFileSync(file, encodeJson({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: mandate(),
      platform,
      recipient,
      chainId: 31337,
      nonce: "82",
    }));
    await expect(run(["propose", "--file", file, "--rpc", "http://127.0.0.1:1"])).rejects.toThrow();
  });
});

describe("signed replay", () => {
  it("does not send a signature whose file already returned, and retries a dropped send", async () => {
    const built = propose(83n);
    const signature = await signBuiltProposal(built, ANVIL);
    const proposer = privateKeyToAccount(ANVIL).address;
    let calls = 0;
    const sender = async () => {
      calls += 1;
      return "0x11" as Hex;
    };
    await filePartnerProposal(built.partner, true, signature, 31337, proposer, sender);
    await expect(filePartnerProposal(built.partner, true, signature, 31337, proposer, sender)).rejects.toMatchObject({
      code: "replay",
    });
    expect(calls).toBe(1);
    const retry = propose(84n);
    const retrySig = await signBuiltProposal(retry, ANVIL);
    await expect(filePartnerProposal(retry.partner, true, retrySig, 31337, proposer, async () => {
      throw new Error("dropped");
    })).rejects.toThrow("dropped");
    await filePartnerProposal(retry.partner, true, retrySig, 31337, proposer, sender);
    expect(calls).toBe(2);
  });

  it("does not treat a stored vault digest as a fresh nonce", async () => {
    const built = propose(85n);
    const facts: VaultFacts = {
      paused: false,
      idle: 50_000n * U,
      totalAssets: 100_000n * U,
      partner: signer,
      signer,
      minFeeBps: 10,
      maxTenorSeconds: 40 * 86_400,
      concentrationCapBps: 5_000,
      expiresAt: now + 86_400,
      payoutTo: recipient,
      approved: true,
      limit: 100_000n * U,
      nonceUsed: false,
      proposalHash: ZERO_HASH,
    };
    const client = (hash: Hex) => ({
      getChainId: async () => 31337,
      readContract: async (args: { functionName: string }) => {
        if (args.functionName === "mandate") {
          return {
            partner: facts.partner,
            signer: facts.signer,
            minFeeBps: facts.minFeeBps,
            maxTenor: BigInt(facts.maxTenorSeconds),
            concentrationBps: facts.concentrationCapBps,
            expiry: BigInt(facts.expiresAt),
          };
        }
        if (args.functionName === "platformConfig") return { approved: true, limit: facts.limit };
        if (args.functionName === "proposalHashOf") return hash;
        if (args.functionName === "preview") return 0;
        return (facts as Record<string, unknown>)[args.functionName];
      },
    }) as unknown as PublicClient;
    const args = { chainId: 31337, mandate: mandate(), platform, message: built.message };
    expect(await vaultGuards(client(ZERO_HASH), args)).toEqual([]);
    const replay = await vaultGuards(client(built.digest), args);
    expect(replay.map((block) => block.code)).toContain("nonce");
  });
});
