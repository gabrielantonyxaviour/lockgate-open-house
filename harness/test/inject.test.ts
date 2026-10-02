import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { send, loadCtx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { failureBody } from "../src/errors.js";
import { readManifest } from "../src/manifest.js";
import { ROLES } from "../src/roles.js";
import { withAnvil } from "./anvil.js";

const SENTINEL = "{\"sentinel\":true}\n";

test("an RPC timeout reports RPC and leaves the manifest bytes", { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "lockgate-inject-"));
  const manifestFile = join(dir, "manifest.json");
  await writeFile(manifestFile, SENTINEL);
  const server = await hangAfterTwo();
  try {
    await assert.rejects(() => deployProtocol(server.url, manifestFile), (err: unknown) => {
      expectBody(err, "RPC", "RPC timed out", true);
      return true;
    });
    await assertIntact(manifestFile, SENTINEL);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a reverted transaction reports REVERT and leaves the manifest bytes", { timeout: 120_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const before = await readFile(manifestFile, "utf8");
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    await assert.rejects(
      () => send(ctx, "investor", "MockUSDG", "faucet", [10_001_000_000n]),
      (err: unknown) => {
        expectBody(err, "REVERT", "FaucetCap", false);
        return true;
      },
    );
    await assertIntact(manifestFile, before);
  });
});

test("a nonce conflict reports NONCE and leaves the manifest bytes", { timeout: 120_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const before = await readFile(manifestFile, "utf8");
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    await assert.rejects(
      () => send(ctx, "lockgate", "MockUSDG", "faucet", [1n], 0),
      (err: unknown) => {
        expectBody(err, "NONCE", "Transaction nonce conflict", true);
        return true;
      },
    );
    await assertIntact(manifestFile, before);
  });
});

function expectBody(err: unknown, code: string, error: string, exact: boolean): void {
  const body = failureBody(err);
  const text = JSON.stringify(body);
  assert.equal(body.code, code);
  assert.equal(exact ? body.error === error : body.error.includes(error), true);
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
  assert.equal(text.includes("\n"), false);
  assert.equal(text.includes(ROLES.investor.key.slice(2)), false);
  assert.equal(text.includes(ROLES.lockgate.key.slice(2)), false);
}

async function assertIntact(manifestFile: string, before: string): Promise<void> {
  const after = await readFile(manifestFile, "utf8");
  assert.equal(after, before);
  JSON.parse(after);
  const names = await readdir(dirname(manifestFile));
  assert.equal(names.some((name) => name.endsWith(".tmp")), false);
}

async function hangAfterTwo(): Promise<{ url: string; close: () => Promise<void> }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = await listenHang();
    if (started.port !== 8545 && started.port !== 0) return started;
    await started.close();
  }
  throw new Error("no loopback port");
}

function listenHang(): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const held: ServerResponse[] = [];
  let answered = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      answered += 1;
      if (answered > 2) {
        held.push(res);
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let method = "";
      try {
        method = (JSON.parse(body) as { method?: string }).method ?? "";
      } catch {
        method = "";
      }
      const result = method === "eth_getBalance" ? "0xde0b6b3a7640000" : "0x7a69";
      const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, result });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
    });
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      const port = address?.port ?? 0;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        async close() {
          for (const res of held) res.destroy();
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
