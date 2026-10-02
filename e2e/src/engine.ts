import { mkdirSync, writeFileSync } from "node:fs";
import { run } from "../../engine/src/cli.ts";
import { DEFAULT_PARAMS } from "../../engine/src/pricing/defaults.ts";
import { z } from "zod";
import type { Address } from "viem";

/** Bigint or a decimal string. A JSON number past 2^53 has already been rounded. */
export const zAmount = z.union([z.bigint(), z.string().regex(/^[0-9]+$/)]).transform((value) => BigInt(value));

export const proposalSchema = z.object({
  submittable: z.boolean(),
  blocks: z.array(z.object({ code: z.string(), reason: z.string() })),
  feeBps: z.number().int(),
  fee: zAmount,
  payout: zAmount,
  digest: z.string(),
  signature: z.string().nullable(),
  message: z.object({
    platform: z.string(),
    recipient: z.string(),
    requestId: zAmount,
    navValue: zAmount,
    fee: zAmount,
    payout: zAmount,
    feeBps: z.number().int(),
    dueAt: zAmount,
    expiresAt: zAmount,
    nonce: zAmount,
    quoteId: z.string(),
  }),
});

export type EngineProposal = z.infer<typeof proposalSchema>;

const quoteSchema = z.object({
  available: z.boolean(),
  feeBps: z.number().int(),
  fee: zAmount,
  blocks: z.array(z.object({ code: z.string(), reason: z.string() })).default([]),
});

export function stageQuoteBody(now: number, nav: bigint) {
  return body(now, nav, "northwind-invoice");
}

function body(now: number, nav: bigint, platformId: string) {
  return {
    input: {
      platformId,
      kind: "weekly-cycle",
      now,
      navValue: nav.toString(),
      queuedAhead: "0",
      cashAvailable: "100000000000",
      cashPerEpoch: "100000000000",
      cashKnown: true,
      gated: false,
      navUpdatedAt: now - 3_600,
      reserveBalance: "10000000000",
      reserveBps: 750,
      exposure: "0",
      limit: "100000000000",
      bookAssets: "1000000000000",
      utilizationBps: 0,
      repayment: { samples: 8, onTime: 8, late: 0, slashed: 0, gateEvents: 0, windowsObserved: 8 },
      epochStart: now,
      epochSeconds: 600,
      clearingSeconds: 60,
      requestedAt: now,
      requestId: "11",
    },
    params: { ...DEFAULT_PARAMS, timeScale: 4320 },
  };
}

export async function engineQuote(now: number, nav: bigint): Promise<z.infer<typeof quoteSchema>> {
  const file = writeBody("quote.json", stageQuoteBody(now, nav));
  return quoteSchema.parse(await run(["quote", "--file", file]));
}

const ZERO = "0x0000000000000000000000000000000000000000";

export type VaultMandate = {
  partner: Address;
  signer: Address;
  minFeeBps: number;
  maxTenorSeconds: number;
  concentrationCapBps: number;
  expiresAt: number;
  idle: bigint;
  totalAssets: bigint;
  limit: bigint;
  paused: boolean;
  payoutTo: Address;
};

export async function enginePropose(args: {
  now: number;
  nav: bigint;
  vault: Address;
  platform: Address;
  nonce: bigint;
  signEnv: string;
  rpc: string;
  mandate: VaultMandate;
}): Promise<EngineProposal> {
  const payout = args.mandate.payoutTo.toLowerCase() === ZERO ? undefined : args.mandate.payoutTo;
  const request = {
    ...stageQuoteBody(args.now, args.nav),
    mandate: {
      vault: args.vault,
      partner: args.mandate.partner,
      signer: args.mandate.signer,
      approvedPlatforms: [args.platform],
      platformLimits: { [args.platform]: args.mandate.limit.toString() },
      minFeeBps: args.mandate.minFeeBps,
      maxTenorSeconds: args.mandate.maxTenorSeconds,
      concentrationCapBps: args.mandate.concentrationCapBps,
      expiresAt: args.mandate.expiresAt,
      idle: args.mandate.idle.toString(),
      totalAssets: args.mandate.totalAssets.toString(),
      paused: args.mandate.paused,
      ...(payout ? { payoutTo: payout } : {}),
    },
    platform: args.platform,
    recipient: payout ?? args.platform,
    chainId: 31_337,
    nonce: args.nonce.toString(),
  };
  const file = writeBody(`propose-${args.vault}-${args.nonce}.json`, request);
  return proposalSchema.parse(await run(["propose", "--file", file, "--rpc", args.rpc, "--sign-env", args.signEnv]));
}

function writeBody(name: string, value: unknown): string {
  const dir = "/tmp/lockgate-g9";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${name}`;
  writeFileSync(file, JSON.stringify(value));
  return file;
}
