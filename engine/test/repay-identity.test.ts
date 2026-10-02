import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { monthEpoch } from "../src/examples.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { buildProposal, type BuiltProposal } from "../src/proposal/build.js";
import { creditLineAbi, planSweep } from "../src/sweep/sweep.js";

const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const firstVault = getAddress("0x00000000000000000000000000000000000000c1");
const secondVault = getAddress("0x00000000000000000000000000000000000000c2");
const firstRecipient = getAddress("0x00000000000000000000000000000000000000b2");
const secondRecipient = getAddress("0x00000000000000000000000000000000000000b3");
const U = 1_000_000n;

function propose(vault: `0x${string}`, recipient: `0x${string}`, nonce: bigint): BuiltProposal {
  return buildProposal({
    input: monthEpoch(now),
    params: DEFAULT_PARAMS,
    mandate: {
      vault,
      partner: vault,
      signer: vault,
      approvedPlatforms: [platform],
      platformLimits: { [platform]: 100_000n * U },
      minFeeBps: 10,
      maxTenorSeconds: 40 * 86_400,
      concentrationCapBps: 5_000,
      expiresAt: now + 86_400,
      payoutTo: recipient,
      idle: 50_000n * U,
      totalAssets: 100_000n * U,
    },
    platform,
    recipient,
    chainId: 31337,
    nonce,
  });
}

describe("repayment identity", () => {
  it("shares a quoteId across nonce, recipient, and vault, and still signs different advances", () => {
    const first = propose(firstVault, firstRecipient, 4n);
    const second = propose(secondVault, secondRecipient, 9n);
    expect(first.submittable).toBe(true);
    expect(second.submittable).toBe(true);
    expect(first.message.quoteId).toBe(second.message.quoteId);
    expect(first.message.nonce).toBe(4n);
    expect(second.message.nonce).toBe(9n);
    expect(first.message.recipient).toBe(firstRecipient);
    expect(second.message.recipient).toBe(secondRecipient);
    expect(first.domain.verifyingContract).toBe(firstVault);
    expect(second.domain.verifyingContract).toBe(secondVault);
    expect(first.message.fee).toBe(second.message.fee);
    expect(first.message.requestId).toBe(second.message.requestId);
    expect(first.digest).not.toBe(second.digest);
    expect(first.calldata).not.toBe(second.calldata);
    const byQuote = new Map<string, bigint>([[first.message.quoteId, first.message.nonce]]);
    byQuote.set(second.message.quoteId, second.message.nonce);
    expect(byQuote.size).toBe(1);
    expect(byQuote.get(first.message.quoteId)).toBe(9n);
  });

  it("routes repay and markLate by advance id, not by the shared quoteId", () => {
    const first = propose(firstVault, firstRecipient, 4n);
    const second = propose(secondVault, secondRecipient, 9n);
    const dueAt = Number(first.message.dueAt);
    expect(second.message.dueAt).toBe(first.message.dueAt);
    const actions = planSweep({
      chainId: 31337,
      now: dueAt + 10,
      graceSeconds: 86_400,
      advances: [
        {
          id: first.message.nonce,
          vault: firstVault,
          platform,
          navValue: first.message.navValue,
          dueAt,
          status: "active",
          cash: first.message.navValue,
          vaultKind: "own-book",
        },
        {
          id: second.message.nonce,
          vault: secondVault,
          platform,
          navValue: second.message.navValue,
          dueAt,
          status: "active",
          cash: second.message.navValue,
          vaultKind: "partner",
        },
      ],
    });
    expect(actions.map((action) => action.kind)).toEqual(["repay", "repay"]);
    expect(actions.map((action) => action.advanceId)).toEqual([4n, 9n]);
    expect(actions[0]?.sendable).toBe(true);
    expect(actions[1]?.sendable).toBe(false);
    expect(actions[1]?.reason).toBe("partner vault: Lockgate will not send repay");
    const decoded = actions.map((action) => {
      if (!action.calldata) throw new Error("missing calldata");
      return decodeFunctionData({ abi: creditLineAbi, data: action.calldata });
    });
    expect(decoded[0]).toMatchObject({ functionName: "repay", args: [4n] });
    expect(decoded[1]).toMatchObject({ functionName: "repay", args: [9n] });
    expect(actions[0]?.calldata).not.toBe(actions[1]?.calldata);
    const packed = actions.map((action) => `${action.reason} ${action.calldata ?? ""}`).join(" ");
    expect(packed).not.toContain(first.message.quoteId.slice(2));
  });
});
