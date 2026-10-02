import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import { run } from "../src/cli.js";
import { enterDryRun, isDryRun, leaveDryRun, type DryRunResult } from "../src/dryrun.js";
import { EngineError } from "../src/errors.js";
import { filePartnerProposal } from "../src/proposal/partner.js";
import { broadcastOwnBook } from "../src/sweep/sweep.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SEND = /eth_sendTransaction|eth_sendRawTransaction|eth_signTransaction/;

const commands = [
  ["example", "--name", "epoch"],
  ["quote", "--file", "fixtures/sepolia/quote.json"],
  ["score", "--file", "fixtures/sepolia/quote.json"],
  ["alerts", "--file", "fixtures/sepolia/quote.json"],
  ["propose", "--file", "fixtures/sepolia/propose.json"],
  ["sweep", "--file", "fixtures/sepolia/sweep.json"],
  ["facility", "--file", "fixtures/sepolia/facility.json"],
  ["backtest", "--scenario", "epoch-repay"],
  ["cre-tick", "--file", "fixtures/sepolia/cre.json"],
  ["cre-sweep", "--file", "fixtures/sepolia/cre-sweep.json"],
  ["check", "--file", "fixtures/sepolia/cre.json"],
];

describe("dry-run", () => {
  afterEach(() => leaveDryRun());

  it("describes every command and never sends a transaction", async () => {
    const bodies: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
      const body = typeof init?.body === "string" ? init.body : "";
      bodies.push(body);
      if (SEND.test(body)) throw new Error("transaction sent");
      throw new Error("network used");
    }) as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), "lockgate-dry-"));
    const found = new Map<string, DryRunResult>();
    try {
      for (const argv of commands) {
        const args = argv[0] === "sweep" ? [...argv, "--report", dir, "--dry-run"] : [...argv, "--dry-run"];
        const result = await run(args) as DryRunResult;
        found.set(argv[0] ?? "", result);
        expect(result.dryRun).toBe(true);
        expect(result.sent).toBe(false);
        expect(result.actions.length).toBeGreaterThan(0);
        expect(result.actions.every((item) => item.send === false)).toBe(true);
      }
      expect(bodies).toEqual([]);
      expect(readdirSync(dir)).toEqual([]);
      expect(isDryRun()).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
    expect(found.get("quote")?.actions[0]?.summary.feeBps).toBe(109);
    expect(found.get("propose")?.actions[0]?.data?.startsWith("0xe7c1fee8")).toBe(true);
    expect(found.get("propose")?.actions[0]?.summary.signature).toBeNull();
    expect(found.get("sweep")?.actions[0]?.kind).toBe("repay");
    expect(found.get("sweep")?.actions[0]?.data?.startsWith("0x371fd8e6")).toBe(true);
    expect(found.get("sweep")?.actions[0]?.summary.wouldSend).toBe(true);
    expect(found.get("facility")?.actions[0]?.summary.wouldDraw).toBe(false);
    expect(found.get("cre-tick")?.actions.some((item) => item.kind === "submitProposal")).toBe(true);
    expect(found.get("cre-sweep")?.actions[0]?.kind).toBe("cre-sweep");
    expect(found.get("cre-sweep")?.actions[0]?.summary.onReportCalled).toBe(false);
    expect(found.get("cre-sweep")?.actions[0]?.summary.broadcast).toBe(false);
    expect(found.get("cre-sweep")?.actions[1]?.kind).toBe("repay");
    expect(found.get("check")?.actions[0]?.kind).toBe("check");
    expect(found.get("check")?.actions[0]?.summary.ok).toBe(true);
    expect(found.get("check")?.actions[0]?.summary.failed).toBe(0);
  });

  it("does not dial rpc or sign when propose is a dry run", async () => {
    const bodies: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
      bodies.push(typeof init?.body === "string" ? init.body : "");
      throw new Error("network used");
    }) as typeof fetch;
    process.env.LOCKGATE_TEST_PROPOSER = KEY;
    try {
      const result = await run([
        "propose",
        "--file",
        "fixtures/sepolia/propose.json",
        "--dry-run",
        "--rpc",
        "http://127.0.0.1:9",
        "--sign-env",
        "LOCKGATE_TEST_PROPOSER",
      ]) as DryRunResult;
      expect(result.sent).toBe(false);
      expect(result.actions[0]?.summary.signature).toBeNull();
      expect(JSON.stringify(result)).not.toContain(KEY);
      expect(bodies).toEqual([]);
    } finally {
      delete process.env.LOCKGATE_TEST_PROPOSER;
      globalThis.fetch = original;
    }
  });

  it("refuses a library send and does not call the sender", async () => {
    enterDryRun();
    const calls: Hex[] = [];
    const sender = async (tx: { to: `0x${string}`; data: Hex }): Promise<Hex> => {
      calls.push(tx.data);
      return "0x01";
    };
    const line = getAddress("0x00000000000000000000000000000000000000c1");
    await expect(broadcastOwnBook([], 31337, line, sender)).rejects.toMatchObject({ code: "refused" });
    await expect(filePartnerProposal(
      { message: {}, domain: {}, digest: "0x", submitCalldata: "0x" } as never,
      true,
      "0x",
      31337,
      line,
      sender,
    )).rejects.toMatchObject({ code: "refused" });
    expect(calls).toEqual([]);
    try {
      await broadcastOwnBook([], 31337, line, sender);
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).message).toContain("dry-run");
    }
  });

  it("rejects a value on --dry-run", async () => {
    await expect(run(["example", "--name", "epoch", "--dry-run", "yes"])).rejects.toMatchObject({ code: "usage" });
  });
});
