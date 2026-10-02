import { getAddress, isAddress, type Hex } from "viem";
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
import { makeQuoteId, type AdvanceMessage } from "./typed.js";

export type BuiltProposal = {
  quote: Quote;
  input: QuoteInput;
  mandate: Mandate;
  message: AdvanceMessage;
  domain: PartnerFiling["domain"];
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
  /** Fixes the clock check. Omit it to use this machine's clock. */
  wall?: number;
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
  const blocks = [...quote.blocks, ...mandateBlocks(quote, input, mandate, platform, recipient, args.wall)];
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
  const partner = buildPartnerFiling({ vault: mandate.vault, chainId: args.chainId, message });
  return {
    quote,
    input,
    mandate,
    message,
    domain: partner.domain,
    digest: partner.digest,
    calldata: partner.submitCalldata,
    partner,
    blocks,
    submittable: blocks.length === 0,
  };
}
