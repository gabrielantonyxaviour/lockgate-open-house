import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EngineError } from "../src/errors.js";
import { activeLevel, formatLog, logEvent } from "../src/log.js";
import { planSweep } from "../src/sweep/sweep.js";
import { runSweep, writeSweepReport } from "../src/sweep/report.js";

const SECRET = `0x${"ab".repeat(32)}`;
const DIGEST = `0x${"11".repeat(32)}`;
const CALLDATA = `0x371fd8e6${"0".repeat(64)}`;

const book = {
  chainId: 31337,
  now: 1_700_000_000,
  graceSeconds: 86_400,
  advances: [{
    id: "11",
    vault: "0x00000000000000000000000000000000000000c1",
    platform: "0x00000000000000000000000000000000000000b1",
    navValue: "10000000000",
    dueAt: 1_700_000_000,
    status: "active",
    cash: "9999999999",
    vaultKind: "own-book",
  }],
};

function capture(write: () => void): string {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    write();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join("");
}

describe("structured logs", () => {
  it("drops lines below the active level and keeps the level name", () => {
    const previous = process.env.LOCKGATE_LOG_LEVEL;
    try {
      delete process.env.LOCKGATE_LOG_LEVEL;
      expect(activeLevel()).toBe("info");
      const quiet = capture(() => logEvent("debug", "hidden", { note: "skip" }));
      expect(quiet).toBe("");
      const kept = capture(() => logEvent("warn", "visible", { note: "keep" }));
      const line = JSON.parse(kept) as { level: string; event: string; note: string };
      expect(line.level).toBe("warn");
      expect(line.event).toBe("visible");
      expect(line.note).toBe("keep");
      process.env.LOCKGATE_LOG_LEVEL = "error";
      expect(capture(() => logEvent("warn", "visible", { note: "keep" }))).toBe("");
      process.env.LOCKGATE_LOG_LEVEL = "not-a-level";
      expect(activeLevel()).toBe("info");
    } finally {
      if (previous === undefined) delete process.env.LOCKGATE_LOG_LEVEL;
      else process.env.LOCKGATE_LOG_LEVEL = previous;
    }
  });

  it("never writes a key or a secret into a log line", () => {
    const line = formatLog("info", "probe", {
      privateKey: SECRET,
      nested: { apiSecret: SECRET, password: "hunter2", note: "ok" },
      signature: `0x${"cd".repeat(65)}`,
      mnemonic: "legal winner thank year wave sausage worth useful legal winner thank yellow",
      message: `LOCKGATE_PROPOSER_KEY=${SECRET}`,
      note: SECRET,
      digest: DIGEST,
      calldata: CALLDATA,
      quoteId: DIGEST,
    });
    expect(line).not.toContain(SECRET.slice(2));
    expect(line).not.toContain("cd".repeat(32));
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("legal winner");
    expect(line).toContain("[redacted]");
    expect(line).toContain(DIGEST);
    expect(line).toContain(CALLDATA);
    expect(line).toContain("\"note\":\"ok\"");
    const badLevel = `privateKey=${SECRET}`;
    const previous = process.env.LOCKGATE_LOG_LEVEL;
    process.env.LOCKGATE_LOG_LEVEL = badLevel;
    try {
      const emitted = capture(() => logEvent("info", "level", { note: "plain" }));
      expect(emitted).not.toContain(SECRET.slice(2));
      expect(emitted).not.toContain(badLevel);
    } finally {
      if (previous === undefined) delete process.env.LOCKGATE_LOG_LEVEL;
      else process.env.LOCKGATE_LOG_LEVEL = previous;
    }
  });
});

describe("sweep reports", () => {
  it("writes one report per sweep and keeps secrets out of the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-sweep-"));
    const first = planSweep(book);
    first[0]!.reason = `privateKey=${SECRET}`;
    const path = writeSweepReport(dir, book, first);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(SECRET.slice(2));
    expect(text).toContain("[redacted]");
    const report = JSON.parse(text) as {
      kind: string;
      counts: { "wait-for-cash": number };
      sendable: number;
    };
    expect(report.kind).toBe("sweep");
    expect(report.counts["wait-for-cash"]).toBe(1);
    expect(report.sendable).toBe(0);
    expect(text).toContain("cash-short");
    const previous = process.env.LOCKGATE_LOG_LEVEL;
    process.env.LOCKGATE_LOG_LEVEL = "warn";
    try {
      const logged = capture(() => {
        runSweep(book, dir);
        runSweep(book, dir);
      });
      expect(logged).not.toContain(SECRET.slice(2));
      expect(logged).toContain("\"waiting\":1");
    } finally {
      if (previous === undefined) delete process.env.LOCKGATE_LOG_LEVEL;
      else process.env.LOCKGATE_LOG_LEVEL = previous;
    }
    expect(readdirSync(dir)).toHaveLength(3);
  });

  it("writes the Sepolia sweep report beside the action list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-sweep-"));
    const actions = await run(["sweep", "--file", "fixtures/sepolia/sweep.json", "--report", dir]) as {
      kind: string;
      sendable: boolean;
    }[];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("repay");
    expect(actions[0]?.sendable).toBe(true);
    const names = readdirSync(dir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^sweep-421614-1700000000-\d+-\d+\.json$/);
    const saved = JSON.parse(readFileSync(join(dir, names[0] ?? ""), "utf8")) as { sendable: number };
    expect(saved.sendable).toBe(1);
  });

  it("refuses a report path that is not a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-sweep-"));
    const blocked = join(dir, "not-a-dir");
    writeFileSync(blocked, "x");
    expect(() => runSweep(book, blocked)).toThrow(EngineError);
    try {
      runSweep(book, blocked);
    } catch (err) {
      expect(err).toMatchObject({ code: "internal" });
      expect(String(err)).not.toContain(SECRET);
    }
  });
});
