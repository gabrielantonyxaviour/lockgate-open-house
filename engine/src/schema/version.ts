import { EngineError } from "../errors.js";

/** Current document versions. Version 1 is the previous shape accepted by the migrator. */
export const MANDATE_SCHEMA_VERSION = 2 as const;
export const CONFIG_SCHEMA_VERSION = 2 as const;
export const PREVIOUS_SCHEMA_VERSION = 1 as const;

export const MANDATE_SCHEMA_ID = "lockgate://schema/mandate/2";
export const MANDATE_SCHEMA_V1_ID = "lockgate://schema/mandate/1";
export const CONFIG_SCHEMA_ID = "lockgate://schema/config/2";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertSupportedVersion(value: unknown, label: "mandate" | "config"): void {
  if (value === undefined) return;
  if (value === PREVIOUS_SCHEMA_VERSION || value === MANDATE_SCHEMA_VERSION) return;
  throw new EngineError("param", `unsupported ${label} schema version`);
}
