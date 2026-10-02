import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { EngineError } from "../errors.js";
import { encodeEntry, nextEntry, redactDecision, replayAudit, type AuditEntry } from "./chain.js";

export const DEFAULT_AUDIT_PATH = "audit/decisions.jsonl";

const KIND = /^[a-z][a-z0-9-]{0,31}$/;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errno(err: unknown): string | undefined {
  if (!err || typeof err !== "object" || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function holderAlive(lockPath: string): boolean {
  try {
    const pid = Number(readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errno(err) === "EPERM";
  }
}

function withLock<T>(lockPath: string, body: () => T): T {
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, String(process.pid));
        return body();
      } finally {
        closeSync(fd);
        try {
          unlinkSync(lockPath);
        } catch {
          // A dead-holder recovery may already have removed it.
        }
      }
    } catch (err) {
      if (err instanceof EngineError) throw err;
      if (errno(err) !== "EEXIST") throw new EngineError("internal", "could not write the audit log");
      if (!holderAlive(lockPath)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // The holder exited between the check and the unlink, or the lock is not removable.
        }
      }
      if (Date.now() - started > 10_000) throw new EngineError("internal", "could not lock the audit log");
      sleep(20);
    }
  }
}

function readLog(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new EngineError("internal", "could not write the audit log");
  }
}

/** Append one redacted decision. A log that already fails replay is left unchanged. */
export function appendAudit(path: string, kind: string, decision: unknown): AuditEntry {
  if (!KIND.test(kind)) throw new EngineError("param", "audit kind is not a command");
  const redacted = redactDecision(decision);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    throw new EngineError("internal", "could not write the audit log");
  }
  return withLock(`${path}.lock`, () => {
    const text = readLog(path);
    const prior = replayAudit(text);
    const entry = nextEntry(prior.at(-1), kind, redacted);
    const prefix = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, `${prefix}${encodeEntry(entry)}\n`);
      renameSync(tmp, path);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // The temp file was never created.
      }
      throw new EngineError("internal", "could not write the audit log");
    }
    return entry;
  });
}
