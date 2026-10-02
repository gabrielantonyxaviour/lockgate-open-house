import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS, replayAudit } from "../src/audit/chain.js";
import { appendAudit } from "../src/audit/store.js";
import { respond, run } from "../src/cli.js";
import { EngineError } from "../src/errors.js";

const PROPOSER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SECRET = `0x${"ab".repeat(32)}`;
const DIGEST = `0x${"cd".repeat(32)}`;

function logPath(): string {
  return join(mkdtempSync(join(tmpdir(), "lockgate-audit-")), "decisions.jsonl");
}

function linesOf(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
}

function decisionAt(path: string, index: number): { dryRun: boolean; result: Record<string, unknown> } {
  const entry = replayAudit(readFileSync(path, "utf8"))[index];
  return entry?.decision as { dryRun: boolean; result: Record<string, unknown> };
}

function expectTamper(text: string, index: number): void {
  try {
    replayAudit(text);
    throw new Error("replay accepted a tampered log");
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ code: "tamper" });
    expect((err as EngineError).message).toContain(`audit line ${index}`);
  }
}

describe("audit log", () => {
  it("links a quote to genesis and replays the fee", () => {
    expect(AUDIT_GENESIS).toBe(createHash("sha256").update("lockgate-audit-v1").digest("hex"));
    const path = logPath();
    appendAudit(path, "quote", { dryRun: false, result: { feeBps: 109, payout: 9891000000n } });
    const text = readFileSync(path, "utf8");
    const [row] = replayAudit(text);
    expect(row?.seq).toBe(0);
    expect(row?.prev).toBe(AUDIT_GENESIS);
    expect(row?.kind).toBe("quote");
    const canonical = JSON.stringify({
      decision: { dryRun: false, result: { feeBps: 109, payout: "9891000000" } },
      kind: "quote",
      prev: AUDIT_GENESIS,
      seq: 0,
    });
    expect(row?.hash).toBe(createHash("sha256").update(canonical).digest("hex"));
    expect(decisionAt(path, 0).result.payout).toBe("9891000000");
    expect(replayAudit("")).toEqual([]);
  });

  it("stores a signature and a key as redacted and still replays", () => {
    const path = logPath();
    const signature = `0x${"ef".repeat(65)}`;
    appendAudit(path, "propose", {
      dryRun: false,
      result: {
        digest: DIGEST,
        quoteId: DIGEST,
        calldata: `0xe7c1fee8${"11".repeat(40)}`,
        hash: DIGEST,
        signature,
        privateKey: SECRET,
        note: SECRET,
        reason: `token=${SECRET}`,
      },
    });
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(SECRET.slice(2));
    expect(text).not.toContain(signature.slice(2));
    expect(text).toContain(DIGEST);
    expect(text).toContain("[redacted]");
    const result = decisionAt(path, 0).result;
    expect(result.signature).toBe("[redacted]");
    expect(result.privateKey).toBe("[redacted]");
    expect(result.digest).toBe(DIGEST);
    expect(result.quoteId).toBe(DIGEST);
    expect(result.calldata).toContain("0xe7c1fee8");
    expect(replayAudit(text)).toHaveLength(1);
  });

  it("detects a changed fee, a swap, a missing middle row, and a replaced hash", () => {
    const path = logPath();
    for (const fee of [109, 112, 25]) appendAudit(path, "quote", { fee });
    const lines = linesOf(path);
    expect(replayAudit(readFileSync(path, "utf8")).map((row) => row.decision)).toEqual([
      { fee: 109 },
      { fee: 112 },
      { fee: 25 },
    ]);

    const changed = JSON.parse(lines[1] ?? "") as { decision: { fee: number } };
    changed.decision.fee = 1;
    const rewritten = [...lines];
    rewritten[1] = JSON.stringify(changed);
    expectTamper(`${rewritten.join("\n")}\n`, 1);

    expectTamper(`${[lines[1], lines[0], lines[2]].join("\n")}\n`, 0);
    expectTamper(`${[lines[0], lines[2]].join("\n")}\n`, 1);

    const rehashed = JSON.parse(lines[2] ?? "") as { hash: string };
    rehashed.hash = "ab".repeat(32);
    const hashed = [...lines];
    hashed[2] = JSON.stringify(rehashed);
    expectTamper(`${hashed.join("\n")}\n`, 2);

    const prefix = `${lines.slice(0, 2).join("\n")}\n`;
    expect(replayAudit(prefix)).toHaveLength(2);
    writeFileSync(path, `${lines[0]}\n{}\n`);
    expect(() => appendAudit(path, "quote", { fee: 7 })).toThrow(EngineError);
    expect(readFileSync(path, "utf8")).toBe(`${lines[0]}\n{}\n`);
  });

  it("appends a quote and a signed proposal, and skips example and a thrown command", async () => {
    const path = logPath();
    const quote = await run(["quote", "--file", "fixtures/sepolia/quote.json", "--audit", path]) as { feeBps: number };
    expect(quote.feeBps).toBe(109);
    expect(decisionAt(path, 0).dryRun).toBe(false);
    expect(decisionAt(path, 0).result.feeBps).toBe(109);

    process.env.LOCKGATE_TEST_PROPOSER = PROPOSER;
    try {
      const signed = await run([
        "propose",
        "--file",
        "fixtures/sepolia/propose.json",
        "--sign-env",
        "LOCKGATE_TEST_PROPOSER",
        "--audit",
        path,
      ]) as { submittable: boolean; signature: string; digest: string };
      expect(signed.submittable).toBe(true);
      expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/);
      const text = readFileSync(path, "utf8");
      expect(text).not.toContain(PROPOSER.slice(2));
      expect(text).not.toContain(signed.signature.slice(2));
      expect(text).toContain(signed.digest);
      expect(decisionAt(path, 1).result.signature).toBe("[redacted]");
    } finally {
      delete process.env.LOCKGATE_TEST_PROPOSER;
    }

    const missed = join(mkdtempSync(join(tmpdir(), "lockgate-audit-")), "skipped.jsonl");
    await run(["example", "--name", "epoch", "--audit", missed]);
    expect(existsSync(missed)).toBe(false);
    await expect(run(["quote", "--audit", path])).rejects.toMatchObject({ code: "usage" });
    expect(linesOf(path)).toHaveLength(2);

    const dry = logPath();
    const described = await run(["quote", "--file", "fixtures/sepolia/quote.json", "--dry-run", "--audit", dry]) as {
      sent: boolean;
      actions: { send: boolean }[];
    };
    expect(described.sent).toBe(false);
    expect(decisionAt(dry, 0).dryRun).toBe(true);
    expect(decisionAt(dry, 0).result.sent).toBe(false);
    expect((decisionAt(dry, 0).result.actions as { send: boolean }[])[0]?.send).toBe(false);

    writeFileSync(dry, "{}\n");
    const failure = await respond(["quote", "--file", "fixtures/sepolia/quote.json", "--audit", dry]);
    expect(failure).toMatchObject({ code: "tamper" });
    expect(JSON.stringify(failure)).not.toMatch(/\sat\s/);
    expect(readFileSync(dry, "utf8")).toBe("{}\n");
  });
});
