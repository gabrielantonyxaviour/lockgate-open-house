import { describe, expect, it } from "vitest";
import { encodeFunctionData, hashTypedData, type Address, type Hex } from "viem";
import { submitProposalAbi } from "../src/proposal/partner.js";
import { advanceTypes, domainFor, makeQuoteId } from "../src/proposal/typed.js";
import { vaultReadAbi } from "../src/proposal/vaultread.js";
import { creditLineAbi } from "../src/sweep/sweep.js";

/** Pinned in contracts/test/partner/Advance.t.sol and checked against forge inspect on 2026-10-02. */
const platform = "0x00000000000000000000000000000000000000A1" as Address;
const recipient = "0x00000000000000000000000000000000000000A2" as Address;
const vault = "0x000000000000000000000000000000000000bEEF" as Address;
const message = {
  platform,
  recipient,
  requestId: 7n,
  navValue: 100_000_000_000n,
  fee: 1_000_000_000n,
  payout: 99_000_000_000n,
  feeBps: 100,
  dueAt: 1_700_000_000n,
  expiresAt: 1_690_000_000n,
  nonce: 3n,
  quoteId: `0x${"aa".repeat(32)}` as Hex,
};

describe("G6 and G7 interface bytes", () => {
  it("matches the pinned AdvanceProposal digest and quote id", () => {
    const digest = hashTypedData({
      domain: domainFor(31337, vault),
      types: advanceTypes,
      primaryType: "AdvanceProposal",
      message,
    });
    expect(digest).toBe("0x1a3fcca79eaf0386f59802c2b5b79c1a4c6335711b63e12c3afc9ba60dd9d2c3");
    expect(makeQuoteId({
      platform,
      navValue: message.navValue,
      fee: message.fee,
      dueAt: 1_700_000_000,
      riskBps: 50,
      utilizationBps: 2000,
      navUpdatedAt: 1_690_001_000,
      kind: "weekly-cycle",
    })).toBe("0x5d2baa95fcb98c34735273acce48b8e68e79063aaa932a1685ce582e634b8b1b");
  });

  it("encodes submitProposal, repay, and markLate with the compiled selectors", () => {
    const submit = encodeFunctionData({
      abi: submitProposalAbi,
      functionName: "submitProposal",
      args: [message, "0x"],
    });
    expect(submit.startsWith("0xe7c1fee8")).toBe(true);
    expect(encodeFunctionData({ abi: creditLineAbi, functionName: "repay", args: [22n] }).startsWith("0x371fd8e6")).toBe(true);
    expect(encodeFunctionData({ abi: creditLineAbi, functionName: "markLate", args: [24n] }).startsWith("0x184f24db")).toBe(true);
  });

  it("reads the PartnerVault views at the compiled selectors", () => {
    const selectors = {
      paused: "0x5c975abb",
      idle: "0x3192164f",
      totalAssets: "0x01e1d114",
      mandate: "0x39b1b96d",
      platformConfig: "0x27c86ce4",
      payoutTo: "0x63aec9af",
      nonceUsed: "0x94d0d3a6",
      proposalHashOf: "0x4628a956",
      preview: "0x4422dd8b",
    } as const;
    const encoded = {
      paused: encodeFunctionData({ abi: vaultReadAbi, functionName: "paused" }),
      idle: encodeFunctionData({ abi: vaultReadAbi, functionName: "idle" }),
      totalAssets: encodeFunctionData({ abi: vaultReadAbi, functionName: "totalAssets" }),
      mandate: encodeFunctionData({ abi: vaultReadAbi, functionName: "mandate" }),
      platformConfig: encodeFunctionData({ abi: vaultReadAbi, functionName: "platformConfig", args: [platform] }),
      payoutTo: encodeFunctionData({ abi: vaultReadAbi, functionName: "payoutTo", args: [platform] }),
      nonceUsed: encodeFunctionData({ abi: vaultReadAbi, functionName: "nonceUsed", args: [3n] }),
      proposalHashOf: encodeFunctionData({ abi: vaultReadAbi, functionName: "proposalHashOf", args: [3n] }),
      preview: encodeFunctionData({ abi: vaultReadAbi, functionName: "preview", args: [message] }),
    };
    for (const name of Object.keys(selectors) as (keyof typeof selectors)[]) {
      expect(encoded[name].startsWith(selectors[name])).toBe(true);
    }
  });
});
