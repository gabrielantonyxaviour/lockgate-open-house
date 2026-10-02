import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { foundry } from "viem/chains";
import { loadArtifact, loadDeployedBytecode } from "../src/artifacts.js";
import { DEMO } from "../src/params.js";
import { MIN_DEPLOYER_WEI } from "../src/preflight.js";
import { ROLES } from "../src/roles.js";
import { PAXOS_USDG_SEPOLIA } from "../src/guards.js";
import {
  assertSepoliaMayBroadcast,
  buildDeployment,
  deploymentManifestSchema,
  executeLocalDeployment,
  readDeploymentManifest,
} from "../src/deployment-manifest.js";
import { HarnessError } from "../src/errors.js";
import { withAnvil } from "./anvil.js";

const OWNERS = {
  deployer: ROLES.lockgate.address,
  governor: ROLES.governor.address,
  partnerA: ROLES.partnerA.address,
  partnerB: ROLES.partnerB.address,
};

test("schema rejects mainnet, a bad address, and a dry run that carries a receipt", () => {
  const doc = buildDeployment({ target: "sepolia", ...OWNERS });
  assert.equal(deploymentManifestSchema.safeParse({ ...doc, chainId: 42161 }).success, false);
  assert.equal(deploymentManifestSchema.safeParse({ ...doc, factory: "0x1234" }).success, false);
  const stamped = { ...doc, steps: doc.steps.map((step, index) => index === 0 ? { ...step, txHash: `0x${"ab".repeat(32)}`, blockNumber: 1 } : step) };
  assert.equal(deploymentManifestSchema.safeParse(stamped).success, false);
  assert.equal(deploymentManifestSchema.safeParse({ ...doc, mode: "executed" }).success, false);
  assert.throws(
    () => buildDeployment({ target: "sepolia", ...OWNERS, governor: OWNERS.deployer }),
    (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
  );
});

test("sepolia plan is deterministic and does not dial", () => {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    seen.push(String(input));
    throw new Error("dialed");
  };
  try {
    const first = buildDeployment({ target: "sepolia", ...OWNERS, factoryNonce: 0 });
    const second = buildDeployment({ target: "sepolia", ...OWNERS });
    const local = buildDeployment({ target: "local", ...OWNERS });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.mode, "dry-run");
    assert.equal(first.chainId, 421614);
    assert.equal(first.steps.length, 18);
    assert.deepEqual(first.steps.map((step) => step.address), local.steps.map((step) => step.address));
    assert.ok(first.steps.every((step) => step.txHash === null && step.blockNumber === null));
    const line = first.steps.find((step) => step.logical === "LockgateCreditLine");
    assert.equal(line?.kind, "create2");
    assert.equal(line?.constructorArgs.length, 4);
    const facility = first.steps.find((step) => step.logical === "CreditFacility");
    const init = facility?.constructorArgs[0] as { advanceRateBps?: string; governor?: string; borrower?: string };
    assert.equal(init.advanceRateBps, "8000");
    assert.equal(init.governor, OWNERS.governor);
    assert.equal(init.borrower, OWNERS.deployer);
    const vault = first.steps.find((step) => step.logical === "PartnerVaultA");
    const impl = first.steps.find((step) => step.logical === "PartnerVaultImpl");
    const usdg = first.steps.find((step) => step.logical === "MockUSDG");
    const initData = encodeFunctionData({
      abi: loadArtifact("PartnerVaultImpl").abi,
      functionName: "initialize",
      args: [OWNERS.partnerA, usdg?.address, 2n * 86_400n, BigInt(DEMO.grace)],
    });
    assert.equal(vault?.constructorArgs[0], impl?.address);
    assert.equal(vault?.constructorArgs[1], initData);
    assert.equal(seen.length, 0);
    assert.equal(JSON.stringify(first).includes(ROLES.lockgate.key), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("a later nonce changes create2 addresses and paxos stays the external token", () => {
  const base = buildDeployment({ target: "sepolia", ...OWNERS, paxos: true });
  const shifted = buildDeployment({ target: "sepolia", ...OWNERS, paxos: true, factoryNonce: 1 });
  assert.notEqual(base.factory, shifted.factory);
  assert.equal(base.asset, "paxos");
  const token = base.steps.find((step) => step.logical === "MockUSDG");
  assert.equal(token?.kind, "external");
  assert.equal(token?.address, PAXOS_USDG_SEPOLIA);
  assert.equal(token?.constructorArgs.length, 0);
  const adapter = base.steps.find((step) => step.logical === "UsdgAdapter");
  assert.equal(adapter?.constructorArgs[0], PAXOS_USDG_SEPOLIA);
  assert.equal(adapter?.constructorArgs[1], false);
  const line = (name: string, doc: typeof base) => doc.steps.find((step) => step.logical === name)?.address;
  assert.notEqual(line("LockgateCreditLine", base), line("LockgateCreditLine", shifted));
  assert.equal(line("MockUSDG", base), line("MockUSDG", shifted));
  assert.throws(
    () => buildDeployment({ target: "local", ...OWNERS, paxos: true }),
    (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
  );
});

test("broadcast stays a dry run unless the brief approves it and the deployer is funded", () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    seen.push(String(input));
    throw new Error("dialed");
  };
  try {
    assert.throws(
      () => assertSepoliaMayBroadcast(10n ** 18n),
      (err: unknown) => err instanceof HarnessError && err.code === "SEPOLIA_BLOCKED",
    );
    assert.throws(
      () => assertSepoliaMayBroadcast(MIN_DEPLOYER_WEI - 1n, true),
      (err: unknown) => err instanceof HarnessError && err.code === "UNFUNDED",
    );
    assert.doesNotThrow(() => assertSepoliaMayBroadcast(MIN_DEPLOYER_WEI, true));
    const blocked = runCli(["broadcast"], {
      LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
      DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
      SEPOLIA_RPC: "https://sepolia-rollup.arbitrum.io/rpc",
    });
    assert.equal(blocked.status, 1);
    assert.equal(JSON.parse(blocked.stderr).code, "SEPOLIA_BLOCKED");
    assert.equal(blocked.stdout, "");
    const dry = runCli(["sepolia"], {
      ...OWNERS_ENV,
      USE_PAXOS_USDG: "1",
      SEPOLIA_RPC: "https://sepolia-rollup.arbitrum.io/rpc",
      DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
    });
    assert.equal(dry.status, 0, dry.stderr);
    const doc = JSON.parse(dry.stdout);
    assert.equal(doc.mode, "dry-run");
    assert.equal(doc.chainId, 421614);
    assert.equal(doc.asset, "paxos");
    assert.equal(dry.stdout.includes(ROLES.lockgate.key), false);
    assert.equal(dry.stderr.includes(ROLES.lockgate.key), false);
    assert.equal(seen.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("local execute records receipts that match the dry-run plan", { timeout: 120_000 }, async () => {
  const dry = buildDeployment({ target: "local", ...OWNERS });
  await withAnvil(async (rpc, file) => {
    const doc = await executeLocalDeployment(rpc, file);
    assert.equal(doc.mode, "executed");
    assert.equal(doc.chainId, 31337);
    assert.equal(doc.target, "local");
    assert.deepEqual(doc.steps.map((step) => step.address), dry.steps.map((step) => step.address));
    assert.deepEqual(doc.steps.map((step) => step.constructorArgs), dry.steps.map((step) => step.constructorArgs));
    const client = createPublicClient({ chain: foundry, transport: http(rpc) });
    for (const step of doc.steps) {
      const txHash = step.txHash ?? "";
      assert.match(txHash, /^0x[0-9a-fA-F]{64}$/);
      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      assert.equal(receipt.status, "success");
      assert.equal(step.blockNumber, Number(receipt.blockNumber));
    }
    const code = await client.getBytecode({ address: doc.factory as `0x${string}` });
    assert.equal(code?.toLowerCase(), loadDeployedBytecode("Create2Factory").bytecode.toLowerCase());
    assert.deepEqual(readDeploymentManifest(file), doc);
    assert.equal(readFileSync(file, "utf8").includes(ROLES.lockgate.key), false);
    const before = readFileSync(file, "utf8");
    await assert.rejects(
      () => executeLocalDeployment(rpc, file),
      (err: unknown) => err instanceof HarnessError && err.code === "NOT_FRESH",
    );
    assert.equal(readFileSync(file, "utf8"), before);
  });
});

test("local execute refuses a public host, port 8545, and chain 42161", { timeout: 30_000 }, async () => {
  const original = globalThis.fetch;
  let dialed = 0;
  globalThis.fetch = async () => {
    dialed += 1;
    throw new Error("dialed");
  };
  try {
    await assert.rejects(
      () => executeLocalDeployment("https://sepolia-rollup.arbitrum.io/rpc", "/tmp/lockgate-manifest-public.json"),
      (err: unknown) => err instanceof HarnessError && err.code === "CHAIN_REFUSED",
    );
    await assert.rejects(
      () => executeLocalDeployment("http://127.0.0.1:8545", "/tmp/lockgate-manifest-shared.json"),
      (err: unknown) => err instanceof HarnessError && err.code === "PORT_RESERVED",
    );
    assert.equal(dialed, 0);
    assert.equal(existsSync("/tmp/lockgate-manifest-public.json"), false);
  } finally {
    globalThis.fetch = original;
  }
  await withAnvil(async (rpc, file) => {
    await assert.rejects(
      () => executeLocalDeployment(rpc, file),
      (err: unknown) => err instanceof HarnessError && err.code === "MAINNET_REFUSED",
    );
    assert.equal(existsSync(file), false);
  }, 42161);
});

const OWNERS_ENV = {
  DEPLOYER_ADDRESS: OWNERS.deployer,
  GOVERNOR_ADDRESS: OWNERS.governor,
  PARTNER_A_ADDRESS: OWNERS.partnerA,
  PARTNER_B_ADDRESS: OWNERS.partnerB,
};

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", "../scripts/deployment-manifest.ts", ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}
