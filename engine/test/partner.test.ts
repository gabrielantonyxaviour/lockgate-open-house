import { describe, expect, it } from "vitest";
import {
  concat,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch } from "../src/examples.js";
import { buildProposal } from "../src/proposal/build.js";
import { PARTNER_TYPE, filePartnerProposal, partnerTypes } from "../src/proposal/partner.js";
import { signPartnerFiling } from "../src/proposal/sign.js";
import { EngineError } from "../src/errors.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
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

function manualDigest(message: ReturnType<typeof built>["partner"]["message"], chainId: number): Hex {
  const domainType = keccak256(toBytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ));
  const domainSeparator = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
    [domainType, keccak256(toBytes("LockgatePartnerVault")), keccak256(toBytes("1")), BigInt(chainId), message.vault],
  ));
  const structHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32, address, address, address, uint256, uint256, uint64, bytes32, uint256, uint64"),
    [
      keccak256(toBytes(PARTNER_TYPE)),
      message.vault,
      message.platform,
      message.recipient,
      message.navValue,
      message.fee,
      message.dueAt,
      message.exitRef,
      message.nonce,
      message.deadline,
    ],
  ));
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

describe("partner filing", () => {
  it("matches the G7 typehash and stays distinct from the G6 digest", () => {
    const proposal = built();
    expect(proposal.submittable).toBe(true);
    expect(proposal.partner.digest).toBe(manualDigest(proposal.partner.message, 31337));
    expect(proposal.partner.digest).not.toBe(proposal.digest);
    expect(built(12n).partner.message.exitRef).not.toBe(proposal.partner.message.exitRef);
  });

  it("signs the partner digest and files only submit", async () => {
    const proposal = built();
    const signature = await signPartnerFiling(proposal.partner, proposal.submittable, ANVIL);
    const recovered = await recoverTypedDataAddress({
      domain: proposal.partner.domain,
      types: partnerTypes,
      primaryType: "AdvanceProposal",
      message: proposal.partner.message,
      signature,
    });
    expect(recovered).toBe(privateKeyToAccount(ANVIL).address);
    const sent: Hex[] = [];
    await filePartnerProposal(proposal.partner, true, signature, 31337, async (tx) => {
      expect(tx.to).toBe(vault);
      expect(tx.data.slice(0, 10)).toBe(proposal.partner.submitCalldata.slice(0, 10));
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
