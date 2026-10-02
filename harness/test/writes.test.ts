import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../src/artifacts.js";
import { main as bytecodeMain } from "../src/bytecode.js";
import { main as checksumMain } from "../src/checksum.js";
import { main as cleanupMain } from "../src/cleanup.js";
import { buildDeployment, executeLocalDeployment, writeDeploymentManifest } from "../src/deployment-manifest.js";
import { scanFiles, scanOutput, type Finding } from "../src/hygiene.js";
import { main as preflightMain } from "../src/preflight.js";
import { ROLES } from "../src/roles.js";
import { startServer } from "../src/server.js";
import { loadCtx } from "../src/chain.js";
import { readManifest } from "../src/manifest.js";
import { freePort, openAnvil } from "./anvil.js";

const harness = fileURLToPath(new URL("..", import.meta.url));
const KEY = `0x${"cd".repeat(32)}`;
const RPC = `https://arb-sepolia.g.alchemy.com/v2/${"b".repeat(20)}`;
const HASH = `0x${"ab".repeat(32)}`;

test("a planted secret in a written record is reported and not echoed", () => {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-writes-"));
  try {
    const safe = join(dir, "safe");
    mkdirSync(safe);
    writeFileSync(join(safe, "record.json"), `${JSON.stringify({
      salt: HASH, initHash: HASH, txHash: HASH, blockHash: HASH, hash: HASH,
      digest: HASH, quoteId: HASH, exitRef: HASH, submitted: HASH, sha256: "ab".repeat(32), rpc: "http://127.0.0.1:8546",
    })}\n`);
    writeFileSync(join(safe, "anvil.pid"), "53114\n");
    assert.equal(scanFiles(safe).length, 0);

    const bad = join(dir, "bad");
    mkdirSync(bad);
    writeFileSync(join(bad, "manifest.json"), `${JSON.stringify({ rpc: RPC, owned: KEY })}\n`);
    writeFileSync(join(bad, "anvil.json"), `${JSON.stringify({ key: ROLES.lockgate.key })}\n`);
    writeFileSync(join(bad, "seal.json"), `${JSON.stringify({ sha256: KEY })}\n`);
    const hits = scanFiles(bad);
    assert.equal(hits.length, 4);
    assert.deepEqual(kinds(hits), ["private-key", "rpc-token"]);
    const body = JSON.stringify(hits);
    assert.equal(body.includes(KEY), false);
    assert.equal(body.includes(ROLES.lockgate.key), false);
    assert.equal(body.includes("b".repeat(20)), false);

    const linked = join(dir, "linked");
    mkdirSync(linked);
    const outside = join(dir, "outside.json");
    writeFileSync(outside, `${JSON.stringify({ owned: KEY })}\n`);
    symlinkSync(outside, join(linked, "manifest.json"));
    assert.equal(scanFiles(linked).length, 0);
    assert.equal(readFileSync(outside, "utf8").includes(KEY), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fresh writes and logs contain no private key or RPC token", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-writes-live-"));
  const manifestFile = join(dir, "31337.json");
  const logs: string[] = [];
  let node = await openAnvil();
  let receiptNode: Awaited<ReturnType<typeof openAnvil>> | undefined;
  try {
    const env = secretEnv(node.rpc, manifestFile);
    const deployed = run("../scripts/deploy-local.ts", [], env);
    assert.equal(deployed.status, 0, redact(deployed.stderr));
    assert.equal(deployed.stdout.includes("\"contracts\""), true, redact(deployed.stdout));
    logs.push(deployed.stdout, deployed.stderr);
    logs.push(await logged((io) => bytecodeMain(env, io), 0, "\"compared\""));
    logs.push(await logged((io) => preflightMain([], env, io), 0, "\"artifactCount\""));

    const registered = run("src/cli.ts", ["stage1.registerPlatform", "--kind", "1", "--limitUsdg", "25000", "--reserveBps", "750", "--initialShares", "1100"], env);
    assert.equal(registered.status, 0, redact(registered.stderr));
    const preview = run("src/cli.ts", ["stage2.preview", "--navUsdg", "1000", "--strategy", "0"], env);
    assert.equal(preview.status, 0, redact(preview.stderr));
    assert.equal(preview.stdout.includes("\"exitRef\""), true, redact(preview.stdout));
    const demo = run("src/cli.ts", ["demo.stage1"], env);
    assert.equal(demo.status, 0, redact(demo.stderr));
    const status = run("src/cli.ts", ["read.status"], env);
    assert.equal(status.status, 0, redact(status.stderr));
    logs.push(registered.stdout, registered.stderr, preview.stdout, preview.stderr, demo.stdout, demo.stderr, status.stdout, status.stderr);

    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    const server = await startServer(ctx, await freePort());
    try {
      const surface = await text(server.url, "/api/surface");
      const body = await text(server.url, "/api/status");
      assert.equal(surface.includes("read.status"), true);
      assert.equal(body.includes("\"capital\""), true);
      logs.push(surface, body);
      const denied = await fetch(`${server.url}/api/act`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "missing", input: {} }),
      });
      const failure = await denied.text();
      assert.equal(denied.status, 422);
      assert.equal(failure.includes("\"error\""), true);
      logs.push(failure);
    } finally {
      await server.close();
    }

    const dry = buildDeployment({
      target: "sepolia",
      deployer: ROLES.lockgate.address,
      governor: ROLES.governor.address,
      partnerA: ROLES.partnerA.address,
      partnerB: ROLES.partnerB.address,
      factoryNonce: 0,
      paxos: false,
    });
    writeDeploymentManifest(dry, join(dir, "sepolia.json"));
    logs.push(JSON.stringify(dry));

    const seal = join(dir, "artifacts.json");
    logs.push(await logged((io) => checksumMain(["write"], { HARNESS_CHECKSUM: seal }, io), 0, "\"wrote\":true"));
    const verified = await logged((io) => checksumMain(["verify"], { HARNESS_CHECKSUM: seal }, io), 0, "\"algorithm\":\"sha256\"");
    assert.equal(verified.includes("wrote"), false);
    logs.push(verified);
    logs.push(await logged((io) => cleanupMain({ ...process.env, HARNESS_RPC: "http://127.0.0.1:1" }, io), 1, "\"code\""));

    await node.stop();
    receiptNode = await openAnvil();
    const doc = await executeLocalDeployment(receiptNode.rpc, join(dir, "receipt.json"));
    logs.push(JSON.stringify({ mode: doc.mode, chainId: doc.chainId, factory: doc.factory, steps: doc.steps.length }));
    for (const name of ["31337.json", "31337.demo.json", "sepolia.json", "artifacts.json", "receipt.json"]) {
      assert.equal(readFileSync(join(dir, name), "utf8").length > 2, true, name);
    }

    const found = [
      ...scanFiles(dir),
      ...scanFiles(join(repoRoot, "harness", "deployments")),
      ...scanFiles(join(repoRoot, "harness", "checksums")),
      ...scanFiles(join(repoRoot, "harness", ".anvil.pid")),
      ...logs.flatMap((entry, index) => scanOutput(`log ${index}`, entry)),
    ];
    assert.equal(found.length, 0, found.map((hit) => detail(hit)).join("\n"));
    const joined = logs.join("\n");
    assert.equal(joined.includes(KEY), false);
    assert.equal(joined.includes(ROLES.lockgate.key), false);
    assert.equal(joined.includes("b".repeat(20)), false);
  } finally {
    await node.stop();
    if (receiptNode) await receiptNode.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

function secretEnv(rpc: string, manifestFile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HARNESS_RPC: rpc,
    HARNESS_MANIFEST: manifestFile,
    DEPLOYER_PRIVATE_KEY: KEY,
    SEPOLIA_RPC: RPC,
    LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "",
  };
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: harness,
    env,
    encoding: "utf8",
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function buffers(): { stdout: (line: string) => void; stderr: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line),
  };
}

async function logged(
  run: (io: ReturnType<typeof buffers>) => Promise<number> | number,
  expected: number,
  marker: string,
): Promise<string> {
  const io = buffers();
  const code = await run(io);
  const text = io.lines.join("\n");
  assert.equal(code, expected, redact(text));
  assert.equal(text.includes(marker), true, redact(text));
  return text;
}

async function text(url: string, path: string): Promise<string> {
  const response = await fetch(`${url}${path}`);
  return await response.text();
}

function kinds(hits: Finding[]): string[] {
  return [...new Set(hits.map((hit) => hit.kind))].sort();
}

function detail(hit: Finding): string {
  return `${hit.path}:${hit.line} ${hit.kind}`;
}

function redact(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{64}/g, "0x[redacted]").replace(/https?:\/\/\S+/g, "[url]");
}
