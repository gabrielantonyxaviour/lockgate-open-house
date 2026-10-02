import { BaseError } from "viem";
import { ZodError } from "zod";

const TRANSPORT =
  /https?:\/\/|HTTP request failed|HTTP response body exceeded|WebSocket request failed|\bfetch failed\b|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|JsonRpc|viem@|Request body:/i;

const NETWORK = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

/** API failures serialize as `{ error, code? }`. Refusals are quotes, not errors. */
export class EngineError extends Error {
  readonly code: string;

  constructor(code: string, error: string) {
    super(error);
    this.name = "EngineError";
    this.code = code;
  }

  toJSON(): { error: string; code: string } {
    return { error: publicMessage(this.message), code: this.code };
  }
}

export type ApiError = { error: string; code?: string };

/** True only for a failure object. A quote, a tick, or a proposal is not one. */
export function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (typeof record.error !== "string" || record.error.length === 0) return false;
  if (record.code !== undefined && typeof record.code !== "string") return false;
  return keys.every((key) => key === "error" || key === "code");
}

function publicMessage(message: string): string {
  const line = message.split(/[\r\n]/)[0]?.replace(/\s+at\s+.*$/, "").trim() ?? "";
  if (!line || line.startsWith("at ") || /\.tsx?:|\bnode:/.test(line)) return "unknown failure";
  return line.slice(0, 240);
}

function textOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "";
}

function errnoOf(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof (current as { code?: unknown }).code === "string") {
      const code = (current as { code: string }).code;
      if (/^E[A-Z0-9_]+$/.test(code)) return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True when the throw, or a cause, carries a transport URL, body, or viem error. */
export function isTransport(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    if (typeof current === "object") seen.add(current);
    if (current instanceof BaseError) return true;
    if (TRANSPORT.test(textOf(current))) return true;
    if (typeof current === "object" && typeof (current as { url?: unknown }).url === "string") return true;
    if (!current || typeof current !== "object") break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Keep an authored engine error. Replace a transport failure with a stable one. */
export function rethrowPublic(err: unknown): never {
  if (err instanceof EngineError) throw err;
  if (isTransport(err) || NETWORK.has(errnoOf(err) ?? "")) throw new EngineError("rpc", "rpc request failed");
  throw err;
}

/** Adapter and vault reads use this so a viem error cannot leave the function. */
export function guardRpc<T>(work: () => Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(work)
    .catch((err: unknown) => {
      rethrowPublic(err);
    });
}

/** Failure payload for the CLI and CRE entries. The stack, URL, and body are never copied. */
export function asApiError(err: unknown): ApiError {
  if (err instanceof EngineError) return { error: publicMessage(err.message), code: err.code };
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.join(".") || "input";
    return { error: publicMessage(`${where}: ${issue?.message ?? "invalid"}`), code: "param" };
  }
  if (err instanceof SyntaxError && !isTransport(err)) return { error: "invalid JSON", code: "param" };
  if (isTransport(err) || NETWORK.has(errnoOf(err) ?? "")) {
    return { error: "rpc request failed", code: "rpc" };
  }
  const fsCode = errnoOf(err);
  if (fsCode === "ENOENT") return { error: "file not found", code: "usage" };
  if (fsCode) return { error: "could not read the file", code: "internal" };
  if (err instanceof Error) return { error: publicMessage(err.message), code: "internal" };
  return { error: "unknown failure", code: "internal" };
}
