import { encodeFunctionData, getAddress, hashTypedData, isAddress, type Hex } from "viem";
import { assertTransactableChain } from "../chains.js";
import { EngineError } from "../errors.js";
import {
  mandateSchema,
  paramsSchema,
  parseOrThrow,
  quoteInputSchema,
  type Mandate,
  type QuoteInput,
} from "../domain.js";
import { applyMandateFloor, quoteExit, type Quote } from "../quote.js";
import { mandateBlocks } from "./mandate.js";
import { buildPartnerFiling, type PartnerFiling } from "./partner.js";
import { advanceTypes, domainFor, makeQuoteId, type AdvanceMessage } from "./typed.js";

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
    outputs: [],
  },
] as const;

export type BuiltProposal = {
  quote: Quote;
  input: QuoteInput;
  mandate: Mandate;
  message: AdvanceMessage;
  domain: ReturnType<typeof domainFor>;
  digest: Hex;
  calldata: Hex;
  partner: PartnerFiling;
  blocks: { code: string; reason: string }[];
  submittable: boolean;
};

export function buildProposal(args: {
  input: unknown;
  params: unknown;
  mandate: unknown;
  platform: string;
  recipient: string;
  chainId: number;
  nonce: bigint;
}): BuiltProposal {
  if (!isAddress(args.platform) || !isAddress(args.recipient)) {
    throw new EngineError("param", "platform and recipient must be addresses");
  }
  const platform = getAddress(args.platform);
  const recipient = getAddress(args.recipient);
  if (recipient === "0x0000000000000000000000000000000000000000") {
    throw new EngineError("param", "recipient is the zero address");
  }
  assertTransactableChain(args.chainId);
  const input = parseOrThrow(quoteInputSchema, args.input);
  const params = parseOrThrow(paramsSchema, args.params);
  const mandate = parseOrThrow(mandateSchema, args.mandate);
  const priced = quoteExit(input, params);
  const quote = priced.available ? applyMandateFloor(priced, mandate.minFeeBps, params.maxFeeBps) : priced;
  const blocks = [...quote.blocks, ...mandateBlocks(quote, input, mandate, platform)];
  const requestId = input.requestId ?? 0n;
  if (quote.available && blocks.length === quote.blocks.length && requestId === 0n) {
    blocks.push({ code: "request", reason: "a proposal must name a non-zero queue request" });
  }
  const expiresAt = Math.min(input.now + params.proposalTtlSeconds, mandate.expiresAt);
  if (quote.available && expiresAt <= input.now) {
    blocks.push({ code: "quote-expired", reason: "proposal expiry is not in the future" });
  }
  const message: AdvanceMessage = {
    platform,
    recipient,
    requestId,
    navValue: quote.navValue,
    fee: quote.fee,
    payout: quote.payout,
    feeBps: quote.feeBps,
    dueAt: BigInt(quote.dueAt),
    expiresAt: BigInt(expiresAt),
    nonce: args.nonce,
    quoteId: makeQuoteId({
      platform,
      navValue: quote.navValue,
      fee: quote.fee,
      dueAt: quote.dueAt,
      riskBps: quote.risk.bps,
      utilizationBps: input.utilizationBps,
      navUpdatedAt: input.navUpdatedAt,
      kind: input.kind,
    }),
  };
  const domain = domainFor(args.chainId, mandate.vault);
  const digest = hashTypedData({ domain, types: advanceTypes, primaryType: "AdvanceProposal", message });
  const calldata = encodeFunctionData({
    abi: submitProposalAbi,
    functionName: "submitProposal",
    args: [message, "0x"],
  });
  const partner = buildPartnerFiling({
    vault: mandate.vault,
    platform,
    recipient,
    navValue: quote.navValue,
    fee: quote.fee,
    dueAt: quote.dueAt,
    requestId,
    quoteId: message.quoteId,
    nonce: args.nonce,
    deadline: expiresAt,
    chainId: args.chainId,
  });
  return {
    quote,
    input,
    mandate,
    message,
    domain,
    digest,
    calldata,
    partner,
    blocks,
    submittable: blocks.length === 0,
  };
}
