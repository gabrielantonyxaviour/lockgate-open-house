import { encodeFunctionData, hashTypedData, type Address, type Hex } from "viem";
import { assertTransactableChain } from "../chains.js";
import { EngineError } from "../errors.js";
import { advanceTypes, domainFor, type AdvanceMessage } from "./typed.js";

/** Same selector and struct as `IPartnerVault.submitProposal`. There is no execute entry. */
export const submitProposalAbi = [
  {
    type: "function",
    name: "submitProposal",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "proposal",
        type: "tuple",
        components: [
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
      },
      { name: "proposerSignature", type: "bytes" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
] as const;

export type PartnerFiling = {
  message: AdvanceMessage;
  domain: ReturnType<typeof domainFor>;
  digest: Hex;
  submitCalldata: Hex;
};

/**
 * Filing for the live vault. `AdvanceHash` delegates to `AdvanceProposalLib`, so this digest
 * is the G6 `LockgateAdvance` digest. The unsigned calldata is `submitProposal`.
 */
export function buildPartnerFiling(args: {
  vault: Address;
  chainId: number;
  message: AdvanceMessage;
}): PartnerFiling {
  const domain = domainFor(args.chainId, args.vault);
  const digest = hashTypedData({
    domain,
    types: advanceTypes,
    primaryType: "AdvanceProposal",
    message: args.message,
  });
  const submitCalldata = encodeFunctionData({
    abi: submitProposalAbi,
    functionName: "submitProposal",
    args: [args.message, "0x"],
  });
  return { message: args.message, domain, digest, submitCalldata };
}

/**
 * File `submitProposal` on an allowed chain. The vault records the digest and moves no tokens.
 * This function has no execute or approve path.
 */
export async function filePartnerProposal(
  filing: PartnerFiling,
  submittable: boolean,
  signature: Hex,
  chainId: number,
  sender: (tx: { to: Address; data: Hex }) => Promise<Hex>,
): Promise<Hex> {
  assertTransactableChain(chainId);
  if (filing.domain.chainId !== chainId) throw new EngineError("param", "chain id does not match the filing");
  if (!submittable) throw new EngineError("refused", "refusing to file a proposal that fails its checks");
  const data = encodeFunctionData({
    abi: submitProposalAbi,
    functionName: "submitProposal",
    args: [filing.message, signature],
  });
  return sender({ to: filing.domain.verifyingContract, data });
}
