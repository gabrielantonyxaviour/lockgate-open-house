export function encodeJson(value: unknown): string {
  return JSON.stringify(toJsonValue(value), null, 2);
}

function toJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
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
