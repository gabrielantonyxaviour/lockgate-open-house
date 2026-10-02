import { z } from "zod";
import { mandateSchema, parseOrThrow, type Mandate } from "../domain.js";
import { EngineError } from "../errors.js";
import { publishJsonSchema } from "./json.js";
import {
  MANDATE_SCHEMA_ID,
  MANDATE_SCHEMA_V1_ID,
  MANDATE_SCHEMA_VERSION,
  PREVIOUS_SCHEMA_VERSION,
  assertSupportedVersion,
  isRecord,
} from "./version.js";

/**
 * Mandate document versions.
 * Version 1 named the tenor `maxTenor`. Version 2 names it `maxTenorSeconds`.
 * Pricing params keep their own `maxTenorSeconds` and are not part of this rename.
 */
const mandateV2 = mandateSchema.extend({
  schemaVersion: z.literal(MANDATE_SCHEMA_VERSION),
}).strict();

const mandateV1 = mandateSchema.omit({ maxTenorSeconds: true }).extend({
  schemaVersion: z.literal(PREVIOUS_SCHEMA_VERSION),
  maxTenor: z.number().int().positive(),
}).strict();

export function mandateJsonSchema(): Record<string, unknown> {
  return publishJsonSchema(mandateV2, MANDATE_SCHEMA_ID);
}

export function mandateJsonSchemaV1(): Record<string, unknown> {
  return publishJsonSchema(mandateV1, MANDATE_SCHEMA_V1_ID);
}

/** Copy `maxTenor` to `maxTenorSeconds` and drop the version stamp. The domain schema parses the result. */
export function migrateMandate(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  assertSupportedVersion(raw.schemaVersion, "mandate");
  const next: Record<string, unknown> = { ...raw };
  delete next.schemaVersion;
  if (!("maxTenor" in next)) return next;
  if ("maxTenorSeconds" in next && next.maxTenor !== next.maxTenorSeconds) {
    throw new EngineError("param", "maxTenor and maxTenorSeconds disagree");
  }
  if (!("maxTenorSeconds" in next)) next.maxTenorSeconds = next.maxTenor;
  delete next.maxTenor;
  return next;
}

export function parseMandate(raw: unknown): Mandate {
  return parseOrThrow(mandateSchema, migrateMandate(raw));
}

/** Migrated mandate plus `schemaVersion: 2`, the document `mandateJsonSchema` accepts. */
export function canonicalMandate(raw: unknown): Record<string, unknown> {
  const migrated = migrateMandate(raw);
  if (!isRecord(migrated)) throw new EngineError("param", "mandate must be an object");
  return { ...migrated, schemaVersion: MANDATE_SCHEMA_VERSION };
}

/** Propose files carry the mandate under `mandate`. Other keys stay put. */
export function migrateProposeBody(raw: unknown): unknown {
  if (!isRecord(raw) || !("mandate" in raw)) return raw;
  return { ...raw, mandate: migrateMandate(raw.mandate) };
}
