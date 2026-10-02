import { asApiError, EngineError } from "./errors.js";

/** Reject numbers JSON.parse has already rounded. Amounts above 2^53 must be decimal strings. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text, (key, value) => {
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        const where = key || "value";
        throw new EngineError("param", `${where}: number is outside the safe integer range; pass a decimal string`);
      }
      return value;
    });
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new EngineError("param", "invalid JSON");
  }
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(toJsonValue(value), null, 2);
}

function toJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return toJsonValue(asApiError(value));
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
      return toJsonValue((value as { toJSON: () => unknown }).toJSON());
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = toJsonValue(inner);
    return out;
  }
  return value;
}
