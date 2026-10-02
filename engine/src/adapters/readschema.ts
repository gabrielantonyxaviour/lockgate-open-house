import { z } from "zod";
import { zAmount } from "../domain.js";
import type { KasuRead } from "./kasu/read.js";
import type { MapleRead } from "./maple/read.js";
import type { UsdaiRead } from "./usdai/read.js";

const notes = z.array(z.string().min(1).max(240)).max(32);

export const kasuReadSchema: z.ZodType<KasuRead> = z.object({
  kind: z.literal("weekly-cycle"),
  epochStart: z.number().int().nonnegative(),
  epochSeconds: z.number().int().positive(),
  clearingSeconds: z.number().int().nonnegative(),
  clearingNow: z.boolean(),
  epochNumber: z.number().int().nonnegative(),
  queuedShares: zAmount,
  queuedValue: zAmount.nullable(),
  poolDecimals: z.union([z.literal(6), z.null()]),
  truncated: z.boolean(),
  notes,
});

export const mapleReadSchema: z.ZodType<MapleRead> = z.object({
  kind: z.literal("fifo-open"),
  nextRequestId: zAmount,
  lastRequestId: zAmount,
  queuedShares: zAmount,
  queuedValue: zAmount.nullable(),
  totalAssets: zAmount.nullable(),
  assetDecimals: z.number().int().min(0).max(36),
  truncated: z.boolean(),
  cashKnown: z.literal(false),
  notes,
});

export const usdaiReadSchema: z.ZodType<UsdaiRead> = z.object({
  kind: z.literal("epoch"),
  nextWindowAt: z.number().int().nonnegative(),
  epochSeconds: z.number().int().positive(),
  pendingShares: zAmount,
  queuedValue: zAmount,
  cashAvailable: zAmount,
  nav: zAmount,
  sharePrice: zAmount,
  assetDecimals: z.number().int().min(0).max(36),
  timestampWasPast: z.boolean(),
  notes,
});
