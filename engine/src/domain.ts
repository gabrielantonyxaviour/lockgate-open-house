import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { EngineError } from "./errors.js";

export const zAmount = z.union([
  z.bigint().nonnegative(),
  z.string().regex(/^[0-9]+$/).transform((value) => BigInt(value)),
  z.number().int().nonnegative().transform((value) => BigInt(value)),
]);

export const zAddress = z.string().refine(isAddress, "address").transform((value) => getAddress(value));

export const repaymentSchema = z.object({
  samples: z.number().int().nonnegative(),
  onTime: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  slashed: z.number().int().nonnegative(),
  gateEvents: z.number().int().nonnegative(),
  windowsObserved: z.number().int().nonnegative(),
}).superRefine((row, ctx) => {
  if (row.onTime + row.late + row.slashed !== row.samples) {
    ctx.addIssue({ code: "custom", message: "onTime + late + slashed must equal samples" });
  }
});

export type RepaymentHistory = z.infer<typeof repaymentSchema>;

/** 1e8 = $1, the same unit as IPegOracle.latest. Omit it, or set enabled false, to skip the check. */
export const pegSchema = z.object({
  enabled: z.boolean(),
  priceE8: zAmount,
  updatedAt: z.number().int().nonnegative(),
  minPriceE8: zAmount,
  maxOracleAge: z.number().int().nonnegative(),
});

export type Peg = z.infer<typeof pegSchema>;

export const paramsSchema = z.object({
  baseAprBps: z.number().int().min(0).max(10_000),
  kinkUtilBps: z.number().int().min(1).max(9_999),
  aprAtKinkBps: z.number().int().min(0).max(10_000),
  aprAtFullBps: z.number().int().min(0).max(10_000),
  minFeeBps: z.number().int().min(0).max(10_000),
  maxFeeBps: z.number().int().min(1).max(10_000),
  timeScale: z.number().int().min(1).max(1_000_000),
  maxRiskPremiumAprBps: z.number().int().min(0).max(10_000),
  navWarnSeconds: z.number().int().nonnegative(),
  maxNavAgeSeconds: z.number().int().positive(),
  navAgeMaxPremiumAprBps: z.number().int().min(0).max(10_000),
  concentrationCapBps: z.number().int().min(1).max(10_000),
  concentrationMaxPremiumAprBps: z.number().int().min(0).max(10_000),
  maxTenorSeconds: z.number().int().positive(),
  proposalTtlSeconds: z.number().int().positive(),
  graceSeconds: z.number().int().nonnegative(),
  minSamples: z.number().int().min(1),
  unknownHistoryBps: z.number().int().min(0).max(10_000),
  unknownGateBps: z.number().int().min(0).max(10_000),
  unknownLiquidityQueueBps: z.number().int().min(0).max(10_000),
}).superRefine((row, ctx) => {
  if (row.aprAtKinkBps < row.baseAprBps || row.aprAtFullBps < row.aprAtKinkBps) {
    ctx.addIssue({ code: "custom", message: "APR curve must be non-decreasing" });
  }
  if (row.minFeeBps > row.maxFeeBps) {
    ctx.addIssue({ code: "custom", message: "min fee above max fee" });
  }
  if (row.navWarnSeconds > row.maxNavAgeSeconds) {
    ctx.addIssue({ code: "custom", message: "NAV warn after NAV max age" });
  }
});

export type PricingParams = z.infer<typeof paramsSchema>;

export const queueKinds = ["weekly-cycle", "epoch", "quarterly-gated", "fifo-open"] as const;
export type QueueKind = (typeof queueKinds)[number];

export const quoteInputSchema = z.object({
  platformId: z.string().min(1).max(120),
  kind: z.enum(queueKinds),
  now: z.number().int().nonnegative(),
  navValue: zAmount,
  queuedAhead: zAmount,
  cashAvailable: zAmount,
  cashPerEpoch: zAmount,
  cashKnown: z.boolean(),
  gated: z.boolean(),
  navUpdatedAt: z.number().int().nonnegative(),
  reserveBalance: zAmount,
  reserveBps: z.number().int().min(0).max(10_000),
  exposure: zAmount,
  limit: zAmount,
  bookAssets: zAmount,
  utilizationBps: z.number().int().min(0).max(10_000),
  repayment: repaymentSchema,
  epochStart: z.number().int().nonnegative().optional(),
  requestedAt: z.number().int().nonnegative().optional(),
  epochSeconds: z.number().int().positive().optional(),
  clearingSeconds: z.number().int().nonnegative().optional(),
  cutoffSeconds: z.number().int().nonnegative().optional(),
  windowSeconds: z.number().int().positive().optional(),
  coveredWaitSeconds: z.number().int().nonnegative().optional(),
  worstCaseSeconds: z.number().int().positive().optional(),
  requestId: zAmount.optional(),
  truncated: z.boolean().optional(),
  allowPartialScan: z.boolean().optional(),
  peg: pegSchema.optional(),
});

export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const mandateSchema = z.object({
  vault: zAddress,
  partner: zAddress,
  signer: zAddress,
  approvedPlatforms: z.array(zAddress).min(1),
  platformLimits: z.record(z.string(), zAmount),
  minFeeBps: z.number().int().min(0).max(10_000),
  maxTenorSeconds: z.number().int().positive(),
  concentrationCapBps: z.number().int().min(1).max(10_000),
  expiresAt: z.number().int().positive(),
});

export type Mandate = z.infer<typeof mandateSchema>;

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, code = "param"): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "input";
    throw new EngineError(code, `${where}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

export function kindCode(kind: QueueKind): number {
  switch (kind) {
    case "weekly-cycle":
      return 1;
    case "epoch":
      return 2;
    case "quarterly-gated":
      return 3;
    case "fifo-open":
      return 4;
  }
}

export type { Address };
