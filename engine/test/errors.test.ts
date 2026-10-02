import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HttpRequestError } from "viem";
import { z } from "zod";
import { readKasu } from "../src/adapters/kasu/read.js";
import { replayAudit } from "../src/audit/chain.js";
import { respond } from "../src/cli.js";
import { creEntry } from "../src/cre/tick.js";
import { blockSendDuringDryRun, enterDryRun, leaveDryRun } from "../src/dryrun.js";
import { asApiError, EngineError, isApiError, type ApiError } from "../src/errors.js";
import { encodeJson } from "../src/json.js";
import { formatLog } from "../src/log.js";
import { broadcastOwnBook, planSweep, type SweepAction } from "../src/sweep/sweep.js";

const URL = "http://127.0.0.1:9/lockgate-rpc-secret";
const BODY = "lockgate-rpc-body";
const LINE = "0x00000000000000000000000000000000000000c1";
const POOL = "0x00000000000000000000000000000000000000aa";

function expectApi(value: unknown, code: string, error?: string): ApiError {
  expect(isApiError(value), JSON.stringify(value)).toBe(true);
  const body = value as ApiError;
  expect(body.code).toBe(code);
  if (error !== undefined) expect(body.error).toBe(error);
  expect(body.error).not.toMatch(/[\r\n]/);
  expect(body.error.startsWith("at ")).toBe(false);
  expect(body.error).not.toMatch(/https?:\/\//);
  expect(body.error).not.toContain("HTTP request failed");
  const encoded = JSON.stringify(body);
  expect(encoded).not.toContain("stack");
  expect(encoded).not.toContain(".ts:");
  expect(encoded).not.toContain("viem@");
  expect(encoded).not.toContain(BODY);
  expect(Object.keys(body).sort()).toEqual(["code", "error"]);
  return body;
}

function hide(value: unknown): void {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  expect(encoded).not.toContain("127.0.0.1");
  expect(encoded).not.toContain("lockgate-rpc");
  expect(encoded).not.toContain("HTTP request failed");
  expect(encoded).not.toContain("viem@");
  expect(encoded).not.toContain("stack");
}

function rpcError(url = URL, body = BODY): HttpRequestError {
  return new HttpRequestError({
    url,
    body: { method: "eth_chainId", leak: body },
    details: `connect ECONNREFUSED ${url} ${body}`,
    status: 500,
  });
}

function write(name: string, body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-errors-"));
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

function quoteFile(patch: { navValue?: string; navUpdatedAt?: number }): string {
  const body = JSON.parse(readFileSync("fixtures/sepolia/quote.json", "utf8")) as {
    input: { navValue: string; navUpdatedAt: number };
  };
  if (patch.navValue !== undefined) body.input.navValue = patch.navValue;
  if (patch.navUpdatedAt !== undefined) body.input.navUpdatedAt = patch.navUpdatedAt;
  return write("quote.json", body);
}

function repayAction(): SweepAction {
  const [action] = planSweep({
    chainId: 31337,
    now: 1_700_000_000,
    graceSeconds: 86_400,
    advances: [{
      id: "11",
      vault: LINE,
      platform: "0x00000000000000000000000000000000000000b1",
      navValue: "10000000000",
      dueAt: 1_700_000_000,
      status: "active",
      cash: "10000000000",
      vaultKind: "own-book",
    }],
  });
  if (!action?.sendable) throw new Error("fixture did not plan a sendable repay");
  return action;
}

describe("failure payloads", () => {
  it("returns amount when the face is outside 1 USDG to 1e12 USDG", async () => {
    const low = await respond(["quote", "--file", quoteFile({ navValue: "1" })]);
    const high = await respond(["quote", "--file", quoteFile({ navValue: "1000000000000000001" })]);
    expectApi(low, "amount", "navValue must be between 1 USDG and 1e12 USDG");
    expectApi(high, "amount", "navValue must be between 1 USDG and 1e12 USDG");
  });

  it("returns param when the NAV timestamp is in the future", async () => {
    const failure = await respond(["quote", "--file", quoteFile({ navUpdatedAt: 1_700_000_001 })]);
    expectApi(failure, "param", "NAV timestamp is in the future");
  });

  it("returns amount from the CRE entry for the same face check", () => {
    const config = JSON.parse(readFileSync("fixtures/sepolia/cre.json", "utf8")) as {
      requests: { input: { navValue: string } }[];
    };
    config.requests[0]!.input.navValue = "1";
    expectApi(creEntry(config), "amount", "navValue must be between 1 USDG and 1e12 USDG");
  });

  it("returns usage when --dry-run is given a value", async () => {
    expectApi(await respond(["example", "--dry-run", "yes"]), "usage", "pass --dry-run without a value");
  });

  it("returns usage for a missing file and does not include the path", async () => {
    const missing = join(tmpdir(), "lockgate-missing-errors.json");
    const failure = await respond(["quote", "--file", missing]);
    expectApi(failure, "usage", "file not found");
    expect(JSON.stringify(failure)).not.toContain("lockgate-missing-errors");
  });

  it("returns internal for a directory read and does not include the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-errors-dir-"));
    const failure = await respond(["quote", "--file", dir]);
    expectApi(failure, "internal", "could not read the file");
    expect(JSON.stringify(failure)).not.toContain(dir);
  });

  it("returns internal for a permission error and does not include the path", () => {
    const denied = Object.assign(new Error("EACCES: permission denied, open '/tmp/lockgate-secret-path.json'"), {
      code: "EACCES",
    });
    const failure = asApiError(denied);
    expectApi(failure, "internal", "could not read the file");
    expect(JSON.stringify(failure)).not.toContain("lockgate-secret-path");
  });

  it("returns internal when the sweep report path is not a directory", async () => {
    const file = write("sweep.json", {
      chainId: 31337,
      now: 1_700_000_000,
      graceSeconds: 86_400,
      advances: [{
        id: "11",
        vault: LINE,
        platform: "0x00000000000000000000000000000000000000b1",
        navValue: "10000000000",
        dueAt: 1_700_000_000,
        status: "active",
        cash: "10000000000",
        vaultKind: "own-book",
      }],
    });
    expectApi(await respond(["sweep", "--file", file, "--report", file]), "internal", "could not write the sweep report");
  });

  it("returns param for zod and replaces a syntax error with invalid JSON", () => {
    const parsed = z.object({ kind: z.string() }).safeParse({});
    if (parsed.success) throw new Error("zod accepted an empty object");
    const zod = expectApi(asApiError(parsed.error), "param");
    expect(zod.error.startsWith("kind:")).toBe(true);
    const syntax = new SyntaxError("Unexpected token /tmp/lockgate-errors.ts:1:1");
    expectApi(asApiError(syntax), "param", "invalid JSON");
  });

  it("drops a stack, caps a long line, and keeps a short internal message", () => {
    expectApi(asApiError(new Error("    at leak (/tmp/lockgate-errors.ts:4:1)")), "internal", "unknown failure");
    expectApi(asApiError("nope"), "internal", "unknown failure");
    expectApi(asApiError(null), "internal", "unknown failure");
    const stacked = new Error("denominator\n    at leak (/tmp/lockgate-errors.ts:1:1)");
    stacked.stack = "Error: denominator\n    at leak (/tmp/lockgate-errors.ts:1:1)";
    expectApi(asApiError(stacked), "internal", "denominator");
    const long = new EngineError("invariant", `${"n".repeat(300)} at leak (/tmp/lockgate-errors.ts:4:1)`);
    const capped = expectApi(asApiError(long), "invariant");
    expect(capped.error).toHaveLength(240);
    expect(capped.error).not.toContain("leak");
  });

  it("returns tamper for a broken audit line", () => {
    try {
      replayAudit("{}\n");
      throw new Error("tampered audit replayed");
    } catch (err) {
      if (err instanceof Error && err.message === "tampered audit replayed") throw err;
      expectApi(asApiError(err), "tamper");
    }
  });

  it("returns refused when a send is attempted during dry-run", () => {
    enterDryRun();
    try {
      blockSendDuringDryRun("submitProposal");
      throw new Error("dry-run allowed a send");
    } catch (err) {
      if (err instanceof Error && err.message === "dry-run allowed a send") throw err;
      expectApi(asApiError(err), "refused", "dry-run refuses to send submitProposal");
    } finally {
      leaveDryRun();
    }
  });

  it("returns replay for two sends of one advance", async () => {
    const action = repayAction();
    try {
      await broadcastOwnBook([action, action], 31337, LINE, async () => "0x11");
      throw new Error("duplicate sweep was sent");
    } catch (err) {
      if (err instanceof Error && err.message === "duplicate sweep was sent") throw err;
      expectApi(asApiError(err), "replay", "duplicate advance in one sweep");
    }
  });

  it("returns partner-key when a sendable row is not the own book", async () => {
    const action = { ...repayAction(), vaultKind: "partner" as const };
    try {
      await broadcastOwnBook([action], 31337, LINE, async () => "0x11");
      throw new Error("partner sweep was sent");
    } catch (err) {
      if (err instanceof Error && err.message === "partner sweep was sent") throw err;
      expectApi(asApiError(err), "partner-key", "refusing to sign a transaction for a partner vault");
    }
  });

  it("replaces a viem error, its cause, and its JSON with a fixed rpc message", () => {
    const direct = rpcError();
    expectApi(asApiError(direct), "rpc", "rpc request failed");
    hide(asApiError(direct));
    hide(encodeJson(direct));
    hide(formatLog("error", "cli", { failure: direct }));
    const wrapped = new Error("HTTP request failed.\nURL: http://127.0.0.1:9/lockgate-rpc-secret");
    wrapped.cause = rpcError("http://10.1.1.9/cause-secret", "cause-body-secret");
    const body = expectApi(asApiError(wrapped), "rpc", "rpc request failed");
    expect(JSON.stringify(body)).not.toContain("cause-body-secret");
    expect(JSON.stringify(body)).not.toContain("10.1.1.9");
    expect(body.error).not.toContain("outer");
  });

  it("returns rpc from a Kasu read whose client throws a transport error", async () => {
    const reader = {
      readContract: async () => {
        throw rpcError("http://127.0.0.1:9/kasu-secret", "kasu-body-secret");
      },
    };
    try {
      await readKasu(reader, { systemVariables: POOL, pendingPool: POOL });
      throw new Error("kasu transport was returned");
    } catch (err) {
      if (err instanceof Error && err.message === "kasu transport was returned") throw err;
      expectApi(asApiError(err), "rpc", "rpc request failed");
      hide(JSON.stringify(err));
      expect(JSON.stringify(err)).not.toContain("kasu-body-secret");
    }
  });

  it("returns rpc from a sweep send whose sender throws a transport error", async () => {
    try {
      await broadcastOwnBook([repayAction()], 31337, LINE, async () => {
        throw rpcError("http://127.0.0.1:9/send-secret", "send-body-secret");
      });
      throw new Error("sweep transport was sent");
    } catch (err) {
      if (err instanceof Error && err.message === "sweep transport was sent") throw err;
      expectApi(asApiError(err), "rpc", "rpc request failed");
      hide(JSON.stringify(err));
      expect(JSON.stringify(err)).not.toContain("send-body-secret");
    }
  });

  it("returns rpc from propose when the endpoint does not answer", async () => {
    const failure = await respond([
      "propose",
      "--file",
      "fixtures/sepolia/propose.json",
      "--rpc",
      "http://127.0.0.1:9",
    ]);
    expectApi(failure, "rpc", "rpc request failed");
    hide(failure);
    hide(formatLog("error", "cli", failure as Record<string, unknown>));
  }, 20_000);
});
