import { EngineError } from "../errors.js";

/** Sorted keys, no whitespace. Bigints become decimal strings. This is not `encodeJson`. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EngineError("internal", "audit decision is not json");
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner === undefined) continue;
      out[key] = normalize(inner);
    }
    return out;
  }
  throw new EngineError("internal", "audit decision is not json");
}
