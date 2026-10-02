import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, http } from "viem";
import { loadArtifact } from "../src/artifacts.js";
import { HarnessError } from "../src/errors.js";
import { PAXOS_USDG_SEPOLIA } from "../src/guards.js";
import { ROLES } from "../src/roles.js";
import { broadcastSepolia } from "../src/sepolia.js";
import { withAnvil } from "./anvil.js";

const KEY = {
  SEPOLIA_RPC: "",
  LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
  DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
};

test("omitting both partners throws before a transaction", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const client = createPublicClient({ transport: http(rpc) });
    const before = await client.getTransactionCount({ address: ROLES.lockgate.address });
    await assert.rejects(
      () => broadcastSepolia({ ...KEY, SEPOLIA_RPC: rpc }, manifestFile),
      (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
    );
    assert.equal(await client.getTransactionCount({ address: ROLES.lockgate.address }), before);
  }, 421614);
});

test("an omitted partner A is the deployer", { timeout: 120_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const manifest = await broadcastSepolia({
      ...KEY,
      SEPOLIA_RPC: rpc,
      PARTNER_B_ADDRESS: ROLES.partnerB.address,
    }, manifestFile);
    assert.equal(manifest.roles.partnerA.toLowerCase(), manifest.roles.deployer.toLowerCase());
    assert.equal(manifest.roles.partnerB.toLowerCase(), ROLES.partnerB.address.toLowerCase());
    assert.notEqual(manifest.roles.governor.toLowerCase(), manifest.roles.deployer.toLowerCase());
    assert.notEqual(manifest.contracts.MockUSDG.toLowerCase(), PAXOS_USDG_SEPOLIA.toLowerCase());
    const client = createPublicClient({ transport: http(rpc) });
    const balance = await client.readContract({
      address: manifest.contracts.MockUSDG as `0x${string}`,
      abi: loadArtifact("MockUSDG").abi,
      functionName: "balanceOf",
      args: [manifest.roles.deployer],
    });
    assert.equal(balance, 1_000_000n * 1_000_000n);
  }, 421614);
});

test("the paxos flag reverts on an empty local chain", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await assert.rejects(
      () => broadcastSepolia({
        ...KEY,
        SEPOLIA_RPC: rpc,
        USE_PAXOS_USDG: "1",
        PARTNER_A_ADDRESS: ROLES.partnerA.address,
        PARTNER_B_ADDRESS: ROLES.partnerB.address,
      }, manifestFile),
      (err: unknown) => err instanceof Error && err.message.includes("DeployFailed"),
    );
  }, 421614);
});
