import { mkdirSync, writeFileSync } from "node:fs";
import { run } from "../../engine/src/cli.ts";
import { DEFAULT_PARAMS } from "../../engine/src/pricing/defaults.ts";
import { z } from "zod";
import type { Address } from "viem";

const zBig = z.union([z.bigint(), z.number(), z.string()]).transform((value) => BigInt(value));

export const proposalSchema = z.object({
  submittable: z.boolean(),
  blocks: z.array(z.object({ code: z.string(), reason: z.string() })),
  feeBps: z.number().int(),
  fee: zBig,
  payout: zBig,
  digest: z.string(),
  signature: z.string().nullable(),
  message: z.object({
    platform: z.string(),
    recipient: z.string(),
    requestId: zBig,
    navValue: zBig,
    fee: zBig,
    payout: zBig,
    feeBps: z.number().int(),
    dueAt: zBig,
    expiresAt: zBig,
    nonce: zBig,
    quoteId: z.string(),
  }),
});

export type EngineProposal = z.infer<typeof proposalSchema>;

const quoteSchema = z.object({
  available: z.boolean(),
  feeBps: z.number().int(),
  fee: zBig,
  blocks: z.array(z.object({ code: z.string(), reason: z.string() })).default([]),
});

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
  const file = writeBody("quote.json", body(now, nav, "northwind-invoice"));
  return quoteSchema.parse(await run(["quote", "--file", file]));
}

export async function enginePropose(args: {
  now: number;
  nav: bigint;
  vault: Address;
  partner: Address;
  signer: Address;
  platform: Address;
  nonce: bigint;
  signEnv: string;
}): Promise<EngineProposal> {
  const request = {
    ...body(args.now, args.nav, "northwind-invoice"),
    mandate: {
      vault: args.vault,
      partner: args.partner,
      signer: args.signer,
      approvedPlatforms: [args.platform],
      platformLimits: { [args.platform]: "100000000000" },
      minFeeBps: 25,
      maxTenorSeconds: 30 * 86_400,
      concentrationCapBps: 10_000,
      expiresAt: args.now + 365 * 86_400,
    },
    platform: args.platform,
    recipient: args.platform,
    chainId: 31_337,
    nonce: args.nonce.toString(),
  };
  const file = writeBody(`propose-${args.vault}-${args.nonce}.json`, request);
  return proposalSchema.parse(await run(["propose", "--file", file, "--sign-env", args.signEnv]));
}

function writeBody(name: string, value: unknown): string {
  const dir = "/tmp/lockgate-g9";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${name}`;
  writeFileSync(file, JSON.stringify(value));
  return file;
}
