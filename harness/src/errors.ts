const KEY = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

export type FailureBody = { error: string; code?: string };

/** First line only. A 32-byte hex key is removed. A longer hex blob, such as a signature, is left in place. */
export function publicMessage(message: string): string {
  const line = message.split(/[\r\n]/)[0]?.replace(/\s+at\s+.*$/, "").trim() ?? "";
  const clean = (line && !line.startsWith("at ") ? line : "unknown failure").replace(KEY, "0x[redacted]");
  return clean.slice(0, 240);
}

export class HarnessError extends Error {
  readonly details: unknown;

  constructor(message: string, readonly code: string, details?: unknown) {
    super(publicMessage(message));
    this.name = "HarnessError";
    this.details = typeof details === "string" ? publicMessage(details) : details;
  }

  toJSON(): FailureBody {
    return failureBody(this);
  }
}

/** CLI, HTTP, and deploy scripts print this object and nothing else. No stack and no key. */
export function failureBody(err: unknown): FailureBody {
  if (err instanceof HarnessError) return { error: publicMessage(err.message), code: err.code };
  if (err instanceof Error) return { error: publicMessage(err.message), code: "INTERNAL" };
  return { error: "unknown failure", code: "INTERNAL" };
}

export function asHarnessError(err: unknown): HarnessError {
  if (err instanceof HarnessError) return err;
  const message = err instanceof Error ? err.message : "unknown failure";
  return new HarnessError(publicMessage(message), "INTERNAL");
}
