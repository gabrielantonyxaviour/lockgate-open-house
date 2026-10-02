import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, runCleanup } from "../src/cleanup.js";
import { HarnessError } from "../src/errors.js";
import { withAnvil } from "./anvil.js";

const PUBLIC_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "lockgate-cleanup-"));
}

function write(dir: string, name: string, body = "{}\n"): void {
  writeFileSync(join(dir, name), body);
}

async function expectCode(run: () => Promise<unknown>, code: string, message: string): Promise<void> {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof HarnessError);
    assert.equal(err.code, code);
    assert.equal(err.message, message);
    return true;
  });
}

test("a public RPC and port 8545 are refused before a reset", async () => {
  const dir = sandbox();
  write(dir, "31337.json", "keep\n");
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetched");
  };
  try {
    await expectCode(
      () => runCleanup({ HARNESS_RPC: PUBLIC_RPC }, { root: dir, reset: async () => { throw new Error("reset"); } }),
      "CHAIN_REFUSED",
      "Harness writes only reach a loopback Anvil",
    );
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8545" }, { root: dir }),
      "PORT_RESERVED",
      "port 8545 belongs to the shared Anvil",
    );
    assert.equal(readFileSync(join(dir, "31337.json"), "utf8"), "keep\n");
  } finally {
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the wrong chain and a refused reset leave the manifests", async () => {
  const dir = sandbox();
  write(dir, "31337.json");
  write(dir, "31337.demo.json");
  try {
    let resets = 0;
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, {
        root: dir,
        chainId: async () => 42161,
        reset: async () => { resets += 1; },
      }),
      "MAINNET_REFUSED",
      "Arbitrum One is refused",
    );
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, {
        root: dir,
        chainId: async () => 1,
        reset: async () => { resets += 1; },
      }),
      "CHAIN_REFUSED",
      "Harness state changes run only on local Anvil (chain 31337)",
    );
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, {
        root: dir,
        chainId: async () => 31337,
        reset: async () => { throw new HarnessError("Anvil reset was refused", "RPC"); },
      }),
      "RPC",
      "Anvil reset was refused",
    );
    assert.equal(resets, 0);
    assert.equal(readFileSync(join(dir, "31337.json"), "utf8"), "{}\n");
    assert.equal(readFileSync(join(dir, "31337.demo.json"), "utf8"), "{}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a symlink, a path outside deployments, and the Sepolia manifest are refused", async () => {
  const dir = sandbox();
  const outside = sandbox();
  write(outside, "secret.json", "outside\n");
  write(dir, "421614.json", "sepolia\n");
  symlinkSync(join(outside, "secret.json"), join(dir, "31337.json"));
  let resets = 0;
  const reset = async () => { resets += 1; };
  try {
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, { root: dir, chainId: async () => 31337, reset }),
      "VALIDATION",
      "Cleanup refuses a symlink in deployments",
    );
    rmSync(join(dir, "31337.json"));
    write(dir, "31337.json");
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546", HARNESS_MANIFEST: join(outside, "secret.json") }, {
        root: dir, chainId: async () => 31337, reset,
      }),
      "VALIDATION",
      "Cleanup only removes manifests inside harness/deployments",
    );
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546", HARNESS_MANIFEST: join(dir, "421614.json") }, {
        root: dir, chainId: async () => 31337, reset,
      }),
      "VALIDATION",
      "Cleanup does not remove the Sepolia manifest",
    );
    mkdirSync(join(dir, "31337.deployment.json"));
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, { root: dir, chainId: async () => 31337, reset }),
      "VALIDATION",
      "Cleanup refuses a non-file in deployments",
    );
    assert.equal(resets, 0);
    assert.equal(readFileSync(join(outside, "secret.json"), "utf8"), "outside\n");
    assert.equal(readFileSync(join(dir, "421614.json"), "utf8"), "sepolia\n");
    assert.equal(lstatSync(join(dir, "31337.deployment.json")).isDirectory(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a successful reset removes generated manifests and keeps other files", async () => {
  const dir = sandbox();
  write(dir, "31337.json");
  write(dir, "31337.demo.json");
  write(dir, "31337.deployment.json");
  write(dir, "31337.json.42.tmp");
  write(dir, "demo.json");
  write(dir, "demo.demo.json");
  write(dir, "notes.txt", "keep\n");
  write(dir, "421614.json", "sepolia\n");
  try {
    const report = await runCleanup({
      HARNESS_RPC: "http://127.0.0.1:8546",
      HARNESS_MANIFEST: join(dir, "demo.json"),
    }, { root: dir, chainId: async () => 31337, reset: async () => undefined });
    assert.deepEqual(report, {
      ok: true,
      chainId: 31337,
      reset: true,
      removed: ["31337.demo.json", "31337.deployment.json", "31337.json", "31337.json.42.tmp", "demo.demo.json", "demo.json"],
    });
    assert.equal(readFileSync(join(dir, "notes.txt"), "utf8"), "keep\n");
    assert.equal(readFileSync(join(dir, "421614.json"), "utf8"), "sepolia\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reset uses empty parameters and a null result", async () => {
  const dir = sandbox();
  write(dir, "31337.json");
  const original = globalThis.fetch;
  const seen: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init && "body" in init ? init.body : "{}")) as { method?: string; params?: unknown };
    seen.push(request.params);
    const result = request.method === "eth_chainId" ? "0x7a69" : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
  try {
    const report = await runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, { root: dir });
    assert.deepEqual(seen, [[], []]);
    assert.deepEqual(report.removed, ["31337.json"]);
  } finally {
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reset error from the node leaves the manifest", async () => {
  const dir = sandbox();
  write(dir, "31337.json", "keep\n");
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init && "body" in init ? init.body : "{}")) as { method?: string };
    if (request.method === "eth_chainId") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x7a69" }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "method not found" } }), { status: 200 });
  };
  try {
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, { root: dir }),
      "RPC",
      "Anvil reset was refused",
    );
    assert.equal(readFileSync(join(dir, "31337.json"), "utf8"), "keep\n");
  } finally {
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a closed loopback port is RPC and keeps the manifest", { timeout: 15_000 }, async () => {
  const dir = sandbox();
  write(dir, "31337.json", "keep\n");
  try {
    await expectCode(
      () => runCleanup({ HARNESS_RPC: "http://127.0.0.1:1" }, { root: dir }),
      "RPC",
      "RPC is unreachable",
    );
    assert.equal(readFileSync(join(dir, "31337.json"), "utf8"), "keep\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing deployments directory still resets and removes nothing", async () => {
  const parent = sandbox();
  let resets = 0;
  try {
    const report = await runCleanup({ HARNESS_RPC: "http://127.0.0.1:8546" }, {
      root: join(parent, "absent"), chainId: async () => 31337, reset: async () => { resets += 1; },
    });
    assert.equal(resets, 1);
    assert.deepEqual(report.removed, []);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("main prints only error and code", async () => {
  const dir = sandbox();
  write(dir, "31337.json", "keep\n");
  const stderr: string[] = [];
  try {
    const status = await main({ HARNESS_RPC: "http://127.0.0.1:8545" }, {
      root: dir,
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    });
    assert.equal(status, 1);
    assert.equal(stderr.length, 1);
    const body = JSON.parse(stderr[0] ?? "{}") as { error?: string; code?: string };
    assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
    assert.equal(body.code, "PORT_RESERVED");
    assert.equal(readFileSync(join(dir, "31337.json"), "utf8"), "keep\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a live Anvil returns to nonce 0 and the manifest is gone", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc) => {
    const dir = sandbox();
    write(dir, "31337.json", "live\n");
    write(dir, "notes.txt", "keep\n");
    try {
      const sent = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendTransaction",
          params: [{ from: DEPLOYER, to: DEPLOYER, value: "0x0" }],
        }),
      });
      assert.equal(sent.ok, true);
      const before = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [DEPLOYER, "latest"] }),
      }).then((response) => response.json()) as { result?: string };
      assert.equal(before.result, "0x1");
      const report = await runCleanup({ HARNESS_RPC: rpc }, { root: dir });
      assert.equal(report.reset, true);
      assert.deepEqual(report.removed, ["31337.json"]);
      const after = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [DEPLOYER, "latest"] }),
      }).then((response) => response.json()) as { result?: string };
      assert.equal(after.result, "0x0");
      assert.equal(readFileSync(join(dir, "notes.txt"), "utf8"), "keep\n");
      assert.equal(JSON.stringify(report).includes("0x"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
