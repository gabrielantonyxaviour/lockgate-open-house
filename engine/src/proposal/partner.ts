import {
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { assertTransactableChain } from "../chains.js";
import { EngineError } from "../errors.js";

export const PARTNER_DOMAIN_NAME = "LockgatePartnerVault";
export const PARTNER_DOMAIN_VERSION = "1";

export const PARTNER_TYPE =
  "AdvanceProposal(address vault,address platform,address recipient,uint256 navValue,uint256 fee,uint64 dueAt,bytes32 exitRef,uint256 nonce,uint64 deadline)";

export const partnerTypes = {
  AdvanceProposal: [
    { name: "vault", type: "address" },
    { name: "platform", type: "address" },
    { name: "recipient", type: "address" },
    { name: "navValue", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "dueAt", type: "uint64" },
    { name: "exitRef", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const partnerSubmitAbi = [
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "proposal",
        type: "tuple",
        components: [
          { name: "vault", type: "address" },
          { name: "platform", type: "address" },
          { name: "recipient", type: "address" },
          { name: "navValue", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "dueAt", type: "uint64" },
          { name: "exitRef", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "engineSig", type: "bytes" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
] as const;

export type PartnerMessage = {
  vault: Address;
  platform: Address;
  recipient: Address;
  navValue: bigint;
  fee: bigint;
  dueAt: bigint;
  exitRef: Hex;
  nonce: bigint;
  deadline: bigint;
};

export type PartnerFiling = {
  message: PartnerMessage;
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  digest: Hex;
  submitCalldata: Hex;
};

/** Binds the queue request and the G6 quote into the one bytes32 G7 signs. */
export function exitRefFor(requestId: bigint, quoteId: Hex): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("uint256, bytes32"), [requestId, quoteId]));
}

export function buildPartnerFiling(args: {
  vault: Address;
  platform: Address;
  recipient: Address;
  navValue: bigint;
  fee: bigint;
  dueAt: number;
  requestId: bigint;
  quoteId: Hex;
  nonce: bigint;
  deadline: number;
  chainId: number;
}): PartnerFiling {
  const message: PartnerMessage = {
    vault: args.vault,
    platform: args.platform,
    recipient: args.recipient,
    navValue: args.navValue,
    fee: args.fee,
    dueAt: BigInt(args.dueAt),
    exitRef: exitRefFor(args.requestId, args.quoteId),
    nonce: args.nonce,
    deadline: BigInt(args.deadline),
  };
  const domain = {
    name: PARTNER_DOMAIN_NAME,
    version: PARTNER_DOMAIN_VERSION,
    chainId: args.chainId,
    verifyingContract: args.vault,
  } as const;
  const digest = hashTypedData({
    domain,
    types: partnerTypes,
    primaryType: "AdvanceProposal",
    message,
  });
  const submitCalldata = encodeFunctionData({
    abi: partnerSubmitAbi,
    functionName: "submit",
    args: [message, "0x"],
  });
  return { message, domain, digest, submitCalldata };
}

/**
 * File `submit` on an allowed chain. PartnerVault.submit records the digest and moves no tokens.
 * This function has no execute path.
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
    abi: partnerSubmitAbi,
    functionName: "submit",
    args: [filing.message, signature],
  });
  return sender({ to: filing.message.vault, data });
}
