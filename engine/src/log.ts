export type LogLevel = "info" | "warn" | "error";

const SECRET = /key|secret|private|signature/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET.test(key) ? "[redacted]" : redact(inner);
    }
    return out;
  }
  return value;
}

/** Structured logs on stderr. Production code does not print through the console object. */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Record<string, unknown>),
  });
  process.stderr.write(`${line}\n`);
}
