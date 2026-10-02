import { describe, expect, it } from "vitest";
import { getAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch } from "../src/examples.js";
import { buildProposal } from "../src/proposal/build.js";
import { advanceTypes } from "../src/proposal/typed.js";
import { signBuiltProposal } from "../src/proposal/sign.js";
import { routeVaults, type VaultCandidate } from "../src/proposal/router.js";
import { EngineError } from "../src/errors.js";
import type { Mandate } from "../src/domain.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const U = 1_000_000n;
const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vaultA = getAddress("0x00000000000000000000000000000000000000c1");
const vaultB = getAddress("0x00000000000000000000000000000000000000c2");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

function mandate(vault: `0x${string}`, minFeeBps: number, idle = 20_000n * U): { mandate: Mandate; idle: bigint; cursor: number } {
  return {
    idle,
    cursor: minFeeBps,
    mandate: {
      vault,
      partner: signer,
      signer,
      approvedPlatforms: [platform],
      platformLimits: { [platform]: 100_000n * U },
      minFeeBps,
      maxTenorSeconds: 40 * 86_400,
      concentrationCapBps: 5_000,
      expiresAt: now + 86_400,
      payoutTo: recipient,
      idle: 50_000n * U,
      totalAssets: 100_000n * U,
    },
  };
}

describe("proposals", () => {
  it("signs an EIP-712 advance the partner can recover, and refuses mainnet", async () => {
    const built = buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: mandate(vaultA, 10).mandate,
      platform,
      recipient,
      chainId: 31337,
      nonce: 4n,
    });
    expect(built.submittable).toBe(true);
    expect(built.message.payout + built.message.fee).toBe(built.message.navValue);
    expect(built.calldata.startsWith("0xe7c1fee8")).toBe(true);
    const signature = await signBuiltProposal(built, ANVIL);
    const recovered = await recoverTypedDataAddress({
      domain: built.domain,
      types: advanceTypes,
      primaryType: "AdvanceProposal",
      message: built.message,
      signature,
    });
    expect(recovered).toBe(privateKeyToAccount(ANVIL).address);
    expect(() => buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: mandate(vaultA, 10).mandate,
      platform,
      recipient,
      chainId: 1,
      nonce: 4n,
    })).toThrow(EngineError);
  });

  it("raises the fee to a vault minimum and rejects an unapproved platform", () => {
    const raised = buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: mandate(vaultA, 400).mandate,
      platform,
      recipient,
      chainId: 31337,
      nonce: 1n,
    });
    expect(raised.submittable).toBe(true);
    expect(raised.quote.feeBps).toBe(400);
    expect(raised.quote.feeFloorSource).toBe("mandate-min");
    const blocked = buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: { ...mandate(vaultA, 10).mandate, approvedPlatforms: [recipient] },
      platform,
      recipient,
      chainId: 31337,
      nonce: 1n,
    });
    expect(blocked.submittable).toBe(false);
    expect(blocked.blocks.map((item) => item.code)).toContain("platform");
  });

  it("will not sign a refused proposal", async () => {
    const built = buildProposal({
      input: { ...monthEpoch(now), gated: true },
      params: DEFAULT_PARAMS,
      mandate: mandate(vaultA, 10).mandate,
      platform,
      recipient,
      chainId: 31337,
      nonce: 1n,
    });
    expect(built.submittable).toBe(false);
    await expect(signBuiltProposal(built, ANVIL)).rejects.toBeInstanceOf(EngineError);
  });

  it("routes to the lowest minimum, the deepest idle, or round-robin", () => {
    const candidates: VaultCandidate[] = [
      mandate(vaultA, 80, 30_000n * U),
      mandate(vaultB, 40, 15_000n * U),
    ];
    candidates[0]!.cursor = 1;
    candidates[1]!.cursor = 2;
    const low = routeVaults(candidates, "lowest-fee", 1500, now, platform, 10_000n * U, 0);
    const deep = routeVaults(candidates, "most-capacity", 1500, now, platform, 10_000n * U, 0);
    const first = routeVaults(candidates, "round-robin", 1500, now, platform, 10_000n * U, 0);
    const second = routeVaults(candidates, "round-robin", 1500, now, platform, 10_000n * U, 1);
    expect(low?.vault).toBe(vaultB);
    expect(deep?.vault).toBe(vaultA);
    expect(first?.vault).not.toBe(second?.vault);
    const poor = [{ ...candidates[1]!, idle: 1n }];
    expect(routeVaults(poor, "lowest-fee", 1500, now, platform, 10_000n * U, 0)).toBeNull();
  });
});
