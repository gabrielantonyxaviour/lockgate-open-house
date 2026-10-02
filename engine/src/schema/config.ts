import { z } from "zod";
import { kasuReadSchema, mapleReadSchema, usdaiReadSchema } from "../adapters/readschema.js";
import {
  mandateSchema,
  paramsSchema,
  parseOrThrow,
  quoteInputSchema,
  zAddress,
  zAmount,
} from "../domain.js";
import { EngineError } from "../errors.js";
import { publishJsonSchema } from "./json.js";
import { migrateMandate } from "./mandate.js";
import {
  CONFIG_SCHEMA_ID,
  CONFIG_SCHEMA_VERSION,
  assertSupportedVersion,
  isRecord,
} from "./version.js";

/** CRE tick config. `runCreTick` parses this after `migrateConfig`. */
export const creConfigSchema = z.object({
  chainId: z.number().int().positive(),
  now: z.number().int().nonnegative(),
  params: paramsSchema,
  policy: z.enum(["lowest-fee", "most-capacity", "round-robin"]).default("lowest-fee"),
  roundRobin: z.number().int().nonnegative().default(0),
  vaults: z.array(z.object({
    mandate: mandateSchema,
    idle: zAmount,
    cursor: z.number().int().nonnegative(),
  })).min(1).max(32),
  requests: z.array(z.object({
    input: quoteInputSchema,
    platform: zAddress,
    recipient: zAddress,
    nonce: zAmount,
    kasu: kasuReadSchema.optional(),
    maple: mapleReadSchema.optional(),
    usdai: usdaiReadSchema.optional(),
  }).superRefine((row, ctx) => {
    const count = [row.kasu, row.maple, row.usdai].filter((item) => item !== undefined).length;
    if (count > 1) ctx.addIssue({ code: "custom", message: "a request can carry one adapter read" });
  })).min(1).max(32),
});

export type CreConfig = z.infer<typeof creConfigSchema>;

const configV2 = creConfigSchema.extend({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
}).strict();

export function configJsonSchema(): Record<string, unknown> {
  return publishJsonSchema(configV2, CONFIG_SCHEMA_ID);
}

/** Stamp the config at version 2 by migrating each embedded mandate. */
export function migrateConfig(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  assertSupportedVersion(raw.schemaVersion, "config");
  const next: Record<string, unknown> = { ...raw };
  delete next.schemaVersion;
  if (!Array.isArray(raw.vaults)) return next;
  next.vaults = raw.vaults.map((vault) => {
    if (!isRecord(vault) || !("mandate" in vault)) return vault;
    return { ...vault, mandate: migrateMandate(vault.mandate) };
  });
  return next;
}

export function parseConfig(raw: unknown): CreConfig {
  return parseOrThrow(creConfigSchema, migrateConfig(raw));
}

/** Migrated config plus `schemaVersion: 2`, the document `configJsonSchema` accepts. */
export function canonicalConfig(raw: unknown): Record<string, unknown> {
  const migrated = migrateConfig(raw);
  if (!isRecord(migrated)) throw new EngineError("param", "config must be an object");
  return { ...migrated, schemaVersion: CONFIG_SCHEMA_VERSION };
}
