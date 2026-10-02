import { createHash } from "node:crypto";
import { z } from "zod";
import { EngineError } from "../errors.js";
import { redactValue } from "../log.js";
import { canonicalJson } from "./canonical.js";

/** sha256("lockgate-audit-v1"). The first row's `prev` is this, not an EIP-712 digest. */
export const AUDIT_GENESIS = createHash("sha256").update("lockgate-audit-v1").digest("hex");

const HEX64 = /^[0-9a-f]{64}$/;

export type AuditEntry = {
  seq: number;
  prev: string;
  kind: string;
  decision: unknown;
  hash: string;
};

const entrySchema = z.object({
  seq: z.number().int().nonnegative(),
  prev: z.string().regex(HEX64),
  kind: z.string().min(1).max(64),
  decision: z.unknown(),
  hash: z.string().regex(HEX64),
}).strict();

type Link = { seq: number; prev: string; kind: string; decision: unknown };

function linkHash(body: Link): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function redactDecision(decision: unknown): unknown {
  return redactValue(decision);
}

export function sealEntry(seq: number, prev: string, kind: string, decision: unknown): AuditEntry {
  const body: Link = { seq, prev, kind, decision };
  return { ...body, hash: linkHash(body) };
}

export function nextEntry(previous: AuditEntry | undefined, kind: string, decision: unknown): AuditEntry {
  return sealEntry(previous ? previous.seq + 1 : 0, previous ? previous.hash : AUDIT_GENESIS, kind, decision);
}

/** Recompute every hash. A broken link, body, or sequence throws `tamper` at that line. */
export function replayAudit(text: string): AuditEntry[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const entries: AuditEntry[] = [];
  for (let index = 0; index < lines.length; index++) {
    entries.push(readLine(lines[index] ?? "", index, entries[index - 1]?.hash));
  }
  return entries;
}

function readLine(line: string, index: number, previousHash: string | undefined): AuditEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new EngineError("tamper", `audit line ${index} is not json`);
  }
  const check = entrySchema.safeParse(parsed);
  if (!check.success) throw new EngineError("tamper", `audit line ${index} is not an entry`);
  const entry = check.data;
  if (entry.seq !== index) throw new EngineError("tamper", `audit line ${index} sequence is ${entry.seq}`);
  const expectedPrev = index === 0 ? AUDIT_GENESIS : previousHash;
  if (entry.prev !== expectedPrev) {
    throw new EngineError("tamper", `audit line ${index} does not follow the previous hash`);
  }
  const again = linkHash({ seq: entry.seq, prev: entry.prev, kind: entry.kind, decision: entry.decision });
  if (again !== entry.hash) throw new EngineError("tamper", `audit line ${index} hash does not match`);
  return entry;
}

export function encodeEntry(entry: AuditEntry): string {
  return canonicalJson(entry);
}
