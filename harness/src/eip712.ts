import { type Address, type Hex, type WalletClient } from "viem";

/** Matches contracts/src/interfaces/AdvanceProposalLib.sol. The vault is the verifying contract, not a field. */
export const ADVANCE_DOMAIN_NAME = "LockgateAdvance";
export const ADVANCE_DOMAIN_VERSION = "1";

export const advanceTypes = {
  AdvanceProposal: [
    { name: "platform", type: "address" },
    { name: "recipient", type: "address" },
    { name: "requestId", type: "uint256" },
    { name: "navValue", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "payout", type: "uint256" },
    { name: "feeBps", type: "uint16" },
    { name: "dueAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "quoteId", type: "bytes32" },
  ],
} as const;

export type AdvanceProposal = {
  platform: Address;
  recipient: Address;
  requestId: bigint;
  navValue: bigint;
  fee: bigint;
  payout: bigint;
  feeBps: number;
  dueAt: bigint;
  expiresAt: bigint;
  nonce: bigint;
  quoteId: Hex;
};

export function proposalTuple(proposal: AdvanceProposal): readonly unknown[] {
  return [
    proposal.platform, proposal.recipient, proposal.requestId, proposal.navValue, proposal.fee,
    proposal.payout, proposal.feeBps, proposal.dueAt, proposal.expiresAt, proposal.nonce, proposal.quoteId,
  ];
}

export async function signProposal(
  wallet: WalletClient,
  proposal: AdvanceProposal,
  chainId: number,
  vault: Address,
): Promise<Hex> {
  if (!wallet.account) throw new Error("signer missing");
  return wallet.signTypedData({
    account: wallet.account,
    domain: {
      name: ADVANCE_DOMAIN_NAME,
      version: ADVANCE_DOMAIN_VERSION,
      chainId,
      verifyingContract: vault,
    },
    types: advanceTypes,
    primaryType: "AdvanceProposal",
    message: proposal,
  });
}
