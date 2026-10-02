import { createPublicClient, getAddress, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { assertTransactableChain } from "../chains.js";
import type { Mandate } from "../domain.js";
import { EngineError, guardRpc } from "../errors.js";
import type { Block } from "../quote.js";
import type { AdvanceMessage } from "./typed.js";

const advanceComponents = [
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
] as const;

/** Views from PartnerVaultRead. No submit, execute, or approve. */
export const vaultReadAbi = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "idle", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "mandate",
    stateMutability: "view",
    inputs: [],
    outputs: [{
      name: "m",
      type: "tuple",
      components: [
        { name: "partner", type: "address" },
        { name: "signer", type: "address" },
        { name: "minFeeBps", type: "uint16" },
        { name: "maxTenor", type: "uint64" },
        { name: "concentrationBps", type: "uint16" },
        { name: "expiry", type: "uint64" },
      ],
    }],
  },
  {
    type: "function",
    name: "platformConfig",
    stateMutability: "view",
    inputs: [{ name: "platform", type: "address" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "approved", type: "bool" },
        { name: "limit", type: "uint256" },
        { name: "reserveBps", type: "uint16" },
        { name: "checkGate", type: "bool" },
        { name: "maxNavAge", type: "uint64" },
      ],
    }],
  },
  {
    type: "function",
    name: "payoutTo",
    stateMutability: "view",
    inputs: [{ name: "platform", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nonceUsed",
    stateMutability: "view",
    inputs: [{ name: "nonce", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "proposalHashOf",
    stateMutability: "view",
    inputs: [{ name: "nonce", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "preview",
    stateMutability: "view",
    inputs: [{ name: "proposal", type: "tuple", components: advanceComponents }],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

/** Same order as `RejectReason` in contracts/src/partner/Types.sol. */
const PREVIEW_NAMES = [
  "none",
  "paused",
  "mandate-expired",
  "platform",
  "recipient",
  "limit",
  "concentration",
  "fee",
  "tenor",
  "cash",
  "reserve",
  "peg",
  "stale-oracle",
  "gated",
  "stale-nav",
  "zero",
  "deadline",
] as const;

export type VaultFacts = {
  paused: boolean;
  idle: bigint;
  totalAssets: bigint;
  partner: Address;
  signer: Address;
  minFeeBps: number;
  maxTenorSeconds: number;
  concentrationCapBps: number;
  expiresAt: number;
  payoutTo: Address;
  approved: boolean;
  limit: bigint;
  nonceUsed: boolean;
  proposalHash: Hex;
};

export function previewName(reason: number): string {
  return PREVIEW_NAMES[reason] ?? "unknown";
}

export function openVaultClient(url: string): PublicClient {
  return createPublicClient({ transport: http(url) });
}

export async function readVaultFacts(
  client: PublicClient,
  vault: Address,
  platform: Address,
  nonce: bigint,
): Promise<VaultFacts> {
  const read = <T>(functionName: "paused" | "idle" | "totalAssets" | "mandate" | "platformConfig" | "payoutTo" | "nonceUsed" | "proposalHashOf", args?: readonly unknown[]) =>
    client.readContract({ address: vault, abi: vaultReadAbi, functionName, args } as never) as Promise<T>;
  const [paused, idle, totalAssets, mandate, config, payoutTo, nonceUsed, proposalHash] = await Promise.all([
    read<boolean>("paused"),
    read<bigint>("idle"),
    read<bigint>("totalAssets"),
    read<{ partner: Address; signer: Address; minFeeBps: number; maxTenor: bigint; concentrationBps: number; expiry: bigint }>("mandate"),
    read<{ approved: boolean; limit: bigint }>("platformConfig", [platform]),
    read<Address>("payoutTo", [platform]),
    read<boolean>("nonceUsed", [nonce]),
    read<Hex>("proposalHashOf", [nonce]),
  ]);
  return {
    paused,
    idle,
    totalAssets,
    partner: getAddress(mandate.partner),
    signer: getAddress(mandate.signer),
    minFeeBps: Number(mandate.minFeeBps),
    maxTenorSeconds: Number(mandate.maxTenor),
    concentrationCapBps: Number(mandate.concentrationBps),
    expiresAt: Number(mandate.expiry),
    payoutTo: getAddress(payoutTo),
    approved: config.approved,
    limit: config.limit,
    nonceUsed,
    proposalHash,
  };
}

export async function previewReason(client: PublicClient, vault: Address, message: AdvanceMessage): Promise<number> {
  const reason = await client.readContract({
    address: vault,
    abi: vaultReadAbi,
    functionName: "preview",
    args: [message],
  });
  return Number(reason);
}

function limitFor(mandate: Mandate, platform: Address): bigint | undefined {
  if (mandate.platformLimits[platform] !== undefined) return mandate.platformLimits[platform];
  const lower = platform.toLowerCase();
  for (const [key, value] of Object.entries(mandate.platformLimits)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** Fields the vault owns. A difference means the file is not the vault you would sign against. */
export function mandateDrift(mandate: Mandate, platform: Address, facts: VaultFacts): Block[] {
  const blocks: Block[] = [];
  const differ = (field: string, detail: string) => {
    blocks.push({ code: "vault-mismatch", reason: `${field}: ${detail}` });
  };
  if ((mandate.paused ?? false) !== facts.paused) differ("paused", "does not match the vault");
  if (mandate.idle === undefined || mandate.idle !== facts.idle) differ("idle", "does not match the vault");
  if (mandate.totalAssets === undefined || mandate.totalAssets !== facts.totalAssets) {
    differ("totalAssets", "does not match the vault");
  }
  if (getAddress(mandate.partner) !== facts.partner) differ("partner", "does not match the vault owner");
  if (getAddress(mandate.signer) !== facts.signer) differ("signer", "does not match the vault");
  if (mandate.minFeeBps !== facts.minFeeBps) differ("minFeeBps", "does not match the vault");
  if (mandate.maxTenorSeconds !== facts.maxTenorSeconds) differ("maxTenorSeconds", "does not match the vault");
  if (mandate.concentrationCapBps !== facts.concentrationCapBps) differ("concentrationCapBps", "does not match the vault");
  if (mandate.expiresAt !== facts.expiresAt) differ("expiresAt", "does not match the vault");
  const chainPayout = facts.payoutTo === zeroAddress ? platform : facts.payoutTo;
  const filePayout = mandate.payoutTo ?? platform;
  if (getAddress(filePayout) !== getAddress(chainPayout)) differ("payoutTo", "does not match the vault");
  if (!facts.approved) differ("approved", "platform is not approved on the vault");
  const limit = limitFor(mandate, platform);
  if (limit === undefined || limit !== facts.limit) differ("limit", "does not match the vault");
  return blocks;
}

/**
 * Read the vault before a signature. `submitProposal` stores the digest and does not preview,
 * so a rejected proposal still occupies the nonce until the owner cancels it.
 */
export function vaultGuards(
  client: PublicClient,
  args: { chainId: number; mandate: Mandate; platform: Address; message: AdvanceMessage },
): Promise<Block[]> {
  return guardRpc(() => readVaultGuards(client, args));
}

async function readVaultGuards(
  client: PublicClient,
  args: { chainId: number; mandate: Mandate; platform: Address; message: AdvanceMessage },
): Promise<Block[]> {
  const chainId = await client.getChainId();
  if (chainId !== args.chainId) throw new EngineError("param", "rpc chain does not match the proposal");
  assertTransactableChain(chainId);
  const facts = await readVaultFacts(client, args.mandate.vault, args.platform, args.message.nonce);
  const blocks = mandateDrift(args.mandate, args.platform, facts);
  if (facts.nonceUsed || facts.proposalHash !== ZERO_HASH) {
    blocks.push({ code: "nonce", reason: "vault already holds this nonce" });
  }
  const reason = await previewReason(client, args.mandate.vault, args.message);
  if (reason !== 0) blocks.push({ code: "vault-preview", reason: `vault preview is ${previewName(reason)}` });
  return blocks;
}
