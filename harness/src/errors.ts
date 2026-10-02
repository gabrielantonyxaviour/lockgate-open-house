const KEY = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const TIMEOUT_TEXT = /timed out|took too long|\btimeout\b/i;
const NONCE_NAME = new Set(["NonceTooLowError", "NonceTooHighError", "NonceMaxValueError"]);
const NONCE_TEXT = /nonce too low|nonce too high|nonce has max value|already known|transaction already imported|replacement transaction underpriced/i;
const TRANSPORT_NAME = new Set(["HttpRequestError", "WebSocketRequestError"]);
const TRANSPORT_TEXT = /HTTP request failed|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up/i;

function walk(err: unknown, visit: (item: object) => void, depth = 0, seen = new Set<object>()): void {
  if (depth > 8 || !err || typeof err !== "object" || seen.has(err)) return;
  seen.add(err);
  visit(err);
  const any = err as { cause?: unknown; walk?: (fn: (inner: unknown) => boolean) => unknown };
  if (typeof any.walk === "function") {
    any.walk((inner) => {
      walk(inner, visit, depth + 1, seen);
      return false;
    });
    return;
  }
  walk(any.cause, visit, depth + 1, seen);
}

function textOf(item: object): string {
  const any = item as { message?: unknown; shortMessage?: unknown; details?: unknown };
  return [any.message, any.shortMessage, any.details].filter((part) => typeof part === "string").join(" ");
}

/** viem's timeout carries a shortMessage, so this check has to run before the revert rule. */
export function isTimeout(err: unknown): boolean {
  let hit = false;
  walk(err, (item) => {
    const name = (item as { name?: unknown }).name;
    if (name === "TimeoutError" || TIMEOUT_TEXT.test(textOf(item))) hit = true;
  });
  return hit;
}

/** The node process is gone or the port is closed. A decoded contract revert is not this. */
export function isUnreachable(err: unknown): boolean {
  let transport = false;
  let revert = false;
  walk(err, (item) => {
    const named = item as { name?: unknown; data?: { errorName?: unknown } };
    if (typeof named.data?.errorName === "string") revert = true;
    const name = named.name;
    if ((typeof name === "string" && TRANSPORT_NAME.has(name)) || TRANSPORT_TEXT.test(textOf(item))) transport = true;
  });
  return transport && !revert;
}

/** A used nonce is not the pre-deploy `NOT_FRESH` check. The node rejects the submitted nonce. */
export function isNonceConflict(err: unknown): boolean {
  let hit = false;
  walk(err, (item) => {
    const name = (item as { name?: unknown }).name;
    if ((typeof name === "string" && NONCE_NAME.has(name)) || NONCE_TEXT.test(textOf(item))) hit = true;
  });
  return hit;
}

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
