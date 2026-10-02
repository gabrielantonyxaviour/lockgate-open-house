import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../src/artifacts.js";
import { scanOutput, scanTree, type Finding } from "../src/hygiene.js";
import { ROLES } from "../src/roles.js";

const harness = fileURLToPath(new URL("..", import.meta.url));

test("a planted private key and RPC token are matches and are not echoed", () => {
  const key = `0x${"cd".repeat(32)}`;
  const rpc = `https://arb-sepolia.g.alchemy.com/v2/${"b".repeat(20)}`;
  const hits = scanOutput("sample", `DEPLOYER_PRIVATE_KEY=${key}\nSEPOLIA_RPC=${rpc}\n`);
  assert.deepEqual(kinds(hits), ["private-key", "rpc-token"]);
  const body = JSON.stringify(hits);
  assert.equal(body.includes(key), false);
  assert.equal(body.includes("b".repeat(20)), false);
  assert.equal(scanOutput("leak", ROLES.lockgate.key).some((hit) => hit.kind === "private-key"), true);
});

test("harness output and the repo contain no private key or RPC token", { timeout: 60_000 }, () => {
  const key = `0x${"cd".repeat(32)}`;
  const rpc = `https://arb-sepolia.g.alchemy.com/v2/${"b".repeat(20)}`;
  const env = {
    ...process.env,
    DEPLOYER_PRIVATE_KEY: key,
    SEPOLIA_RPC: rpc,
    HARNESS_RPC: "http://127.0.0.1:1",
    LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "",
    DEPLOYER_ADDRESS: ROLES.lockgate.address,
    GOVERNOR_ADDRESS: ROLES.governor.address,
    PARTNER_A_ADDRESS: ROLES.partnerA.address,
    PARTNER_B_ADDRESS: ROLES.partnerB.address,
  };
  const output = commands.flatMap(([script, arg]) => {
    const run = spawnSync(process.execPath, ["--import", "tsx", script, ...(arg ? [arg] : [])], {
      cwd: harness,
      env,
      encoding: "utf8",
    });
    const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    return scanOutput(`${script} ${arg ?? ""}`.trim(), text);
  });
  const repo = scanTree(repoRoot);
  assert.equal(output.length + repo.length, 0, [...output, ...repo].map(where).join("\n"));
});

const commands: Array<[string, string?]> = [
  ["src/cli.ts", "help"],
  ["../scripts/deployment-manifest.ts", "sepolia"],
  ["../scripts/deployment-manifest.ts", "broadcast"],
  ["../scripts/preflight.ts"],
  ["../scripts/preflight.ts", "sepolia"],
  ["../scripts/deploy-sepolia.ts"],
  ["../scripts/deploy-local.ts"],
];

function kinds(hits: Finding[]): string[] {
  return [...new Set(hits.map((hit) => hit.kind))].sort();
}

function where(hit: Finding): string {
  return `${hit.path}:${hit.line} ${hit.kind}`;
}
