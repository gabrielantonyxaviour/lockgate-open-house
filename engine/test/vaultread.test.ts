import { getAddress, zeroAddress, type Hex, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { EngineError } from "../src/errors.js";
import type { Mandate } from "../src/domain.js";
import { mandateDrift, previewName, vaultGuards, type VaultFacts } from "../src/proposal/vaultread.js";
import type { AdvanceMessage } from "../src/proposal/typed.js";

const platform = getAddress("0x00000000000000000000000000000000000000b1");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const partner = getAddress("0x00000000000000000000000000000000000000d1");
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

function mandate(patch: Partial<Mandate> = {}): Mandate {
  return {
    vault,
    partner,
    signer: partner,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: 100_000n * 1_000_000n },
    minFeeBps: 10,
    maxTenorSeconds: 3_456_000,
    concentrationCapBps: 5_000,
    expiresAt: 1_700_086_400,
    idle: 20_000n * 1_000_000n,
    totalAssets: 20_000n * 1_000_000n,
    ...patch,
  };
}

function facts(patch: Partial<VaultFacts> = {}): VaultFacts {
  return {
    paused: false,
    idle: 20_000n * 1_000_000n,
    totalAssets: 20_000n * 1_000_000n,
    partner,
    signer: partner,
    minFeeBps: 10,
    maxTenorSeconds: 3_456_000,
    concentrationCapBps: 5_000,
    expiresAt: 1_700_086_400,
    payoutTo: zeroAddress,
    approved: true,
    limit: 100_000n * 1_000_000n,
    nonceUsed: false,
    proposalHash: ZERO_HASH,
    ...patch,
  };
}

function message(): AdvanceMessage {
  return {
    platform,
    recipient: platform,
    requestId: 11n,
    navValue: 10_000n * 1_000_000n,
    fee: 109n * 1_000_000n,
    payout: 9_891n * 1_000_000n,
    feeBps: 109,
    dueAt: 1_702_592_000n,
    expiresAt: 1_700_000_600n,
    nonce: 4n,
    quoteId: ZERO_HASH,
  };
}

function client(reads: Record<string, unknown>, chainId = 31337): PublicClient {
  return {
    getChainId: async () => chainId,
    readContract: async (args: { functionName: string }) => {
      if (!(args.functionName in reads)) throw new Error(`unexpected ${args.functionName}`);
      return reads[args.functionName];
    },
  } as unknown as PublicClient;
}

function readsFrom(row: VaultFacts, preview = 0): Record<string, unknown> {
  return {
    paused: row.paused,
    idle: row.idle,
    totalAssets: row.totalAssets,
    mandate: {
      partner: row.partner,
      signer: row.signer,
      minFeeBps: row.minFeeBps,
      maxTenor: BigInt(row.maxTenorSeconds),
      concentrationBps: row.concentrationCapBps,
      expiry: BigInt(row.expiresAt),
    },
    platformConfig: { approved: row.approved, limit: row.limit, reserveBps: 750, checkGate: false, maxNavAge: 0n },
    payoutTo: row.payoutTo,
    nonceUsed: row.nonceUsed,
    proposalHashOf: row.proposalHash,
    preview,
  };
}

describe("vault read", () => {
  it("accepts a file that matches the vault", () => {
    expect(mandateDrift(mandate(), platform, facts())).toEqual([]);
  });

  it("rejects a lied idle, a foreign payout, and an unapproved platform", () => {
    expect(mandateDrift(mandate({ idle: 1n }), platform, facts())[0]).toMatchObject({ code: "vault-mismatch" });
    const other = getAddress("0x00000000000000000000000000000000000000b2");
    expect(mandateDrift(mandate({ payoutTo: other }), platform, facts())[0]?.reason).toContain("payoutTo");
    expect(mandateDrift(mandate(), platform, facts({ approved: false }))[0]?.reason).toContain("approved");
  });

  it("names preview reasons and blocks a taken nonce or a cash rejection", async () => {
    expect(previewName(9)).toBe("cash");
    expect(previewName(10)).toBe("reserve");
    expect(previewName(99)).toBe("unknown");
    const taken = await vaultGuards(client(readsFrom(facts({ proposalHash: `0x${"ab".repeat(32)}` as Hex }))), {
      chainId: 31337,
      mandate: mandate(),
      platform,
      message: message(),
    });
    expect(taken.map((block) => block.code)).toContain("nonce");
    const cash = await vaultGuards(client(readsFrom(facts(), 9)), {
      chainId: 31337,
      mandate: mandate(),
      platform,
      message: message(),
    });
    expect(cash).toEqual([{ code: "vault-preview", reason: "vault preview is cash" }]);
  });

  it("refuses a mainnet rpc and a chain that is not the proposal chain", async () => {
    const args = { chainId: 1, mandate: mandate(), platform, message: message() };
    await expect(vaultGuards(client(readsFrom(facts()), 1), args)).rejects.toBeInstanceOf(EngineError);
    await expect(vaultGuards(client(readsFrom(facts()), 31337), { ...args, chainId: 421614 })).rejects.toMatchObject({
      code: "param",
    });
  });
});
