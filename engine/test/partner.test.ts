import { describe, expect, it } from "vitest";
import {
  concat,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch } from "../src/examples.js";
import { buildProposal } from "../src/proposal/build.js";
import { filePartnerProposal, submitProposalAbi } from "../src/proposal/partner.js";
import { signBuiltProposal, signPartnerFiling } from "../src/proposal/sign.js";
import { advanceTypes, type AdvanceMessage } from "../src/proposal/typed.js";
import { EngineError } from "../src/errors.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const LIVE_TYPE =
  "AdvanceProposal(address platform,address recipient,uint256 requestId,uint256 navValue,uint256 fee,uint256 payout,uint16 feeBps,uint64 dueAt,uint64 expiresAt,uint256 nonce,bytes32 quoteId)";
const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");

function built(requestId = 11n) {
  return buildProposal({
    input: { ...monthEpoch(now), requestId },
    params: DEFAULT_PARAMS,
    mandate: {
      vault,
      partner: vault,
      signer: vault,
      approvedPlatforms: [platform],
      platformLimits: { [platform]: 100_000_000_000n },
      minFeeBps: 10,
      maxTenorSeconds: 40 * 86_400,
      concentrationCapBps: 5_000,
      expiresAt: now + 86_400,
    },
    platform,
    recipient,
    chainId: 31337,
    nonce: 4n,
  });
}

function manualDigest(message: AdvanceMessage, chainId: number, verifyingContract: Address): Hex {
  const domainType = keccak256(toBytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ));
  const domainSeparator = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
    [domainType, keccak256(toBytes("LockgateAdvance")), keccak256(toBytes("1")), BigInt(chainId), verifyingContract],
  ));
  const structHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32, address, address, uint256, uint256, uint256, uint256, uint16, uint64, uint64, uint256, bytes32"),
    [
      keccak256(toBytes(LIVE_TYPE)),
      message.platform,
      message.recipient,
      message.requestId,
      message.navValue,
      message.fee,
      message.payout,
      message.feeBps,
      message.dueAt,
      message.expiresAt,
      message.nonce,
      message.quoteId,
    ],
  ));
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

describe("partner filing", () => {
  it("files the live AdvanceProposal digest, not a second struct", () => {
    const proposal = built();
    expect(submitProposalAbi.map((item) => item.name)).toEqual(["submitProposal"]);
    expect(proposal.submittable).toBe(true);
    expect(proposal.partner.digest).toBe(manualDigest(proposal.partner.message, 31337, vault));
    expect(proposal.partner.digest).toBe(proposal.digest);
    expect(proposal.partner.submitCalldata).toBe(proposal.calldata);
    expect(proposal.partner.domain.name).toBe("LockgateAdvance");
    expect(built(12n).partner.digest).not.toBe(proposal.partner.digest);
  });

  it("signs the same digest as the G6 proposal and files only submitProposal", async () => {
    const proposal = built();
    const signature = await signPartnerFiling(proposal.partner, proposal.submittable, ANVIL);
    const g6 = await signBuiltProposal(proposal, ANVIL);
    const recovered = await recoverTypedDataAddress({
      domain: proposal.partner.domain,
      types: advanceTypes,
      primaryType: "AdvanceProposal",
      message: proposal.partner.message,
      signature,
    });
    expect(recovered).toBe(privateKeyToAccount(ANVIL).address);
    expect(g6).toBe(signature);
    const sent: Hex[] = [];
    await filePartnerProposal(proposal.partner, true, signature, 31337, async (tx) => {
      expect(tx.to).toBe(vault);
      expect(tx.data.slice(0, 10)).toBe(proposal.calldata.slice(0, 10));
      expect(tx.data).not.toBe(proposal.calldata);
      sent.push(tx.data);
      return "0x11";
    });
    expect(sent).toHaveLength(1);
  });

  it("does not call the sender for a refused quote or a forbidden chain", async () => {
    const proposal = built();
    let calls = 0;
    const sender = async (): Promise<Hex> => {
      calls += 1;
      return "0x11";
    };
    await expect(filePartnerProposal(proposal.partner, false, "0x", 31337, sender)).rejects.toThrow(EngineError);
    await expect(filePartnerProposal(proposal.partner, true, "0x", 1, sender)).rejects.toThrow(EngineError);
    await expect(filePartnerProposal(proposal.partner, true, "0x", 42161, sender)).rejects.toThrow(EngineError);
    expect(calls).toBe(0);
    await expect(signPartnerFiling(proposal.partner, false, ANVIL)).rejects.toThrow(EngineError);
  });
});
