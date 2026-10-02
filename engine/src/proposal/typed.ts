import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { kindCode, zAddress, zAmount, type QueueKind } from "../domain.js";

const UINT64 = (1n << 64n) - 1n;

const zUint64 = zAmount.refine((value) => value <= UINT64, "fits in uint64");

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

export type AdvanceMessage = {
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

/** The EIP-712 message. `feeBps` is a uint16, the timestamps are uint64, and payout funds nav minus fee. */
export const advanceMessageSchema = z.object({
  platform: zAddress,
  recipient: zAddress,
  requestId: zAmount,
  navValue: zAmount,
  fee: zAmount,
  payout: zAmount,
  feeBps: z.number().int().min(0).max(65_535),
  dueAt: zUint64,
  expiresAt: zUint64,
  nonce: zAmount,
  quoteId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).superRefine((row, ctx) => {
  if (row.fee + row.payout !== row.navValue) {
    ctx.addIssue({ code: "custom", message: "payout plus fee must equal nav" });
  }
});

export function domainFor(chainId: number, vault: Address) {
  return {
    name: ADVANCE_DOMAIN_NAME,
    version: ADVANCE_DOMAIN_VERSION,
    chainId,
    verifyingContract: vault,
  } as const;
}

export function makeQuoteId(parts: {
  platform: Address;
  navValue: bigint;
  fee: bigint;
  dueAt: number;
  riskBps: number;
  utilizationBps: number;
  navUpdatedAt: number;
  kind: QueueKind;
}): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address, uint256, uint256, uint64, uint16, uint16, uint64, uint8"),
    [
      parts.platform,
      parts.navValue,
      parts.fee,
      BigInt(parts.dueAt),
      parts.riskBps,
      parts.utilizationBps,
      BigInt(parts.navUpdatedAt),
      kindCode(parts.kind),
    ],
  ));
}
