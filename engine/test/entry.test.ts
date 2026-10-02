import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getAddress } from "viem";
import { respond, run } from "../src/cli.js";
import { creEntry } from "../src/cre/tick.js";
import { asApiError, isApiError, type ApiError } from "../src/errors.js";
import { monthEpoch } from "../src/examples.js";
import { encodeJson } from "../src/json.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

function expectFailure(value: unknown, code: string): void {
  expect(isApiError(value), JSON.stringify(value)).toBe(true);
  const body = value as ApiError;
  expect(body.code).toBe(code);
  expect(body.error).not.toMatch(/[\r\n]/);
  expect(body.error.startsWith("at ")).toBe(false);
  const encoded = JSON.stringify(body);
  expect(encoded).not.toContain("stack");
  expect(encoded).not.toContain(".ts:");
  expect(Object.keys(body).sort()).toEqual(["code", "error"]);
}

function write(name: string, body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-entry-"));
  const file = join(dir, name);
  writeFileSync(file, typeof body === "string" ? body : encodeJson(body));
  return file;
}

function creConfig(chainId = 31337) {
  return {
    chainId,
    now,
    params: DEFAULT_PARAMS,
    policy: "lowest-fee",
    vaults: [{
      idle: "50000000000",
      cursor: 1,
      mandate: {
        vault,
        partner: signer,
        signer,
        approvedPlatforms: [platform],
        platformLimits: { [platform]: "100000000000" },
        minFeeBps: 20,
        maxTenorSeconds: 40 * 86_400,
        concentrationCapBps: 5000,
        expiresAt: now + 86_400,
        payoutTo: recipient,
        idle: "50000000000",
        totalAssets: "100000000000",
      },
    }],
    requests: [{ input: monthEpoch(now), platform, recipient, nonce: "7" }],
  };
}

async function proposeFile(chainId = 31337): Promise<string> {
  const example = await run(["example", "--name", "epoch"]);
  const platformId = "0x00000000000000000000000000000000000000b1";
  return write("propose.json", {
    ...(example as object),
    platform: platformId,
    recipient: "0x00000000000000000000000000000000000000b2",
    chainId,
    nonce: "3",
    mandate: {
      vault: "0x00000000000000000000000000000000000000c1",
      partner: "0x00000000000000000000000000000000000000d1",
      signer: "0x00000000000000000000000000000000000000d1",
      approvedPlatforms: [platformId],
      platformLimits: { [platformId]: "100000000000" },
      minFeeBps: 10,
      maxTenorSeconds: 4_000_000,
      concentrationCapBps: 5000,
      expiresAt: now + 86_400,
      payoutTo: "0x00000000000000000000000000000000000000b2",
      idle: "50000000000",
      totalAssets: "100000000000",
    },
  });
}

describe("cli and cre entries", () => {
  it("returns a quote for a valid file and does not treat it as an error", async () => {
    const example = await respond(["example"]);
    expect(isApiError(example)).toBe(false);
    const file = write("quote.json", example);
    const quote = await respond(["quote", "--file", file]) as { available?: boolean };
    expect(isApiError(quote)).toBe(false);
    expect(quote.available).toBe(true);
    const tick = creEntry(creConfig());
    expect(isApiError(tick)).toBe(false);
  });

  it("returns a coded error for every rejected command line", async () => {
    const file = write("bad.json", { kind: "epoch" });
    const lines: [string[], string][] = [
      [[], "usage"],
      [["nope"], "usage"],
      [["quote", "plain.json"], "usage"],
      [["quote", "--extra", "1"], "usage"],
      [["quote", "--file"], "usage"],
      [["quote"], "usage"],
      [["score"], "usage"],
      [["alerts"], "usage"],
      [["propose"], "usage"],
      [["sweep"], "usage"],
      [["facility"], "usage"],
      [["cre-tick"], "usage"],
      [["cre-sweep"], "usage"],
      [["check"], "usage"],
      [["example", "--name", "nope"], "usage"],
      [["example", "--file", file], "usage"],
      [["backtest", "--scenario", "nope"], "usage"],
      [["quote", "--file", file], "param"],
      [["score", "--file", file], "param"],
      [["alerts", "--file", file], "param"],
      [["propose", "--file", file], "param"],
      [["sweep", "--file", file], "param"],
      [["facility", "--file", file], "param"],
      [["cre-tick", "--file", file], "param"],
      [["cre-sweep", "--file", file], "param"],
    ];
    for (const [argv, code] of lines) expectFailure(await respond(argv), code);
  });

  it("hides parser, missing-file, and stack details", async () => {
    expectFailure(await respond(["quote", "--file", write("broken.json", "{")]), "param");
    expectFailure(await respond(["quote", "--file", write("huge.json", '{"nav":9007199254740993}')]), "param");
    expectFailure(await respond(["quote", "--file", join(tmpdir(), "lockgate-missing-entry.json")]), "usage");
    const parsed = z.object({ kind: z.string() }).safeParse({});
    if (parsed.success) throw new Error("zod accepted an empty object");
    const zod = asApiError(parsed.error);
    expectFailure(zod, "param");
    const stacked = new Error("bad\n    at secret (/tmp/lockgate-entry.ts:1:1)");
    stacked.stack = "Error: bad\n    at secret (/tmp/lockgate-entry.ts:1:1)";
    expectFailure(asApiError(stacked), "internal");
    expect(asApiError("nope")).toEqual({ error: "unknown failure", code: "internal" });
  });

  it("rejects a bad proposal flag, a forbidden chain, and a signing env that is not a name", async () => {
    const file = await proposeFile();
    expectFailure(await respond(["propose", "--file", file, "--rpc"]), "usage");
    expectFailure(await respond(["propose", "--file", file, "--rpc", "ftp://127.0.0.1/rpc"]), "param");
    expectFailure(await respond(["propose", "--file", file, "--sign-env", ANVIL]), "param");
    expect(JSON.stringify(await respond(["propose", "--file", file, "--sign-env", ANVIL]))).not.toContain(ANVIL);
    delete process.env.LOCKGATE_ENTRY_UNSET;
    expectFailure(await respond(["propose", "--file", file, "--sign-env", "LOCKGATE_ENTRY_UNSET"]), "param");
    process.env.LOCKGATE_ENTRY_BAD = "not-hex";
    try {
      expectFailure(await respond(["propose", "--file", file, "--sign-env", "LOCKGATE_ENTRY_BAD"]), "param");
    } finally {
      delete process.env.LOCKGATE_ENTRY_BAD;
    }
    expectFailure(await respond(["propose", "--file", await proposeFile(1)]), "mainnet-forbidden");
    expectFailure(await respond(["propose", "--file", await proposeFile(42161)]), "mainnet-forbidden");
  });

  it("returns a coded error for every rejected CRE config", () => {
    const config = creConfig();
    const vault = config.vaults[0];
    const request = config.requests[0];
    const cases: [unknown, string][] = [
      [null, "param"],
      [[], "param"],
      [{}, "param"],
      [{ ...config, chainId: 0 }, "param"],
      [{ ...config, chainId: 1 }, "mainnet-forbidden"],
      [{ ...config, chainId: 42161 }, "mainnet-forbidden"],
      [{ ...config, chainId: 8453 }, "mainnet-forbidden"],
      [{ ...config, now: -1 }, "param"],
      [{ ...config, policy: "cheapest" }, "param"],
      [{ ...config, vaults: [] }, "param"],
      [{ ...config, requests: [] }, "param"],
      [{ ...config, vaults: Array.from({ length: 33 }, () => vault) }, "param"],
      [{ ...config, requests: Array.from({ length: 33 }, () => request) }, "param"],
      [{ ...config, requests: [{ ...request, nonce: "-1" }] }, "param"],
      [{ ...config, requests: [{ ...request, platform: "not-an-address" }] }, "param"],
      [{ ...config, params: { ...DEFAULT_PARAMS, minFeeBps: 100, maxFeeBps: 1 } }, "param"],
    ];
    for (const [raw, code] of cases) expectFailure(creEntry(raw), code);
  });
});
