import { asApiError } from "./errors.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Field names. `key` also matches `privateKey`. Safe names keep public digests and calldata. */
const SECRET = /key|secret|private|signature|password|token|mnemonic|credential/i;
const SAFE = /^(digest|calldata|quoteId|hash)$/i;
const KEY_HEX = /^0x[0-9a-fA-F]{64}$/;
const ASSIGN =
  /([A-Za-z0-9_.-]*(?:key|secret|private|signature|password|token|mnemonic|credential)[A-Za-z0-9_.-]*)(\s*[=:]\s*)([^\s,}"']+)/gi;

export function activeLevel(): LogLevel {
  const raw = process.env.LOCKGATE_LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

export function redactValue(value: unknown, key?: string): unknown {
  if (key && SECRET.test(key)) return "[redacted]";
  if (value instanceof Error) return asApiError(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [name, inner] of Object.entries(value)) out[name] = redactValue(inner, name);
    return out;
  }
  if (typeof value === "string") {
    if (KEY_HEX.test(value) && !(key && SAFE.test(key))) return "[redacted]";
    return value.replace(ASSIGN, (_match, name: string, sep: string) => `${name}${sep}[redacted]`);
  }
  return value;
}

/** One JSON line. Production code does not print through the console object. */
export function formatLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}): string {
  const body = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redactValue(fields) as Record<string, unknown>),
  };
  return JSON.stringify(body, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner));
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (RANK[level] < RANK[activeLevel()]) return;
  process.stderr.write(`${formatLog(level, event, fields)}\n`);
}
