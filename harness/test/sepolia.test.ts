import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { loadDeployedBytecode } from "../src/artifacts.js";
import { HarnessError } from "../src/errors.js";
import { ROLES } from "../src/roles.js";
import { broadcastSepolia } from "../src/sepolia.js";
import { withAnvil } from "./anvil.js";

test("sepolia broadcast stays off without the allow flag", async () => {
  await assert.rejects(
    () => broadcastSepolia({}, "/tmp/lockgate-sepolia-unused.json"),
    (err: unknown) => err instanceof HarnessError && err.code === "SEPOLIA_BLOCKED",
  );
});

test("sepolia broadcast refuses a node that reports chain 42161", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc) => {
    await assert.rejects(
      () => broadcastSepolia({
        SEPOLIA_RPC: rpc,
        LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
        DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
      }, "/tmp/lockgate-sepolia-mainnet.json"),
      (err: unknown) => err instanceof HarnessError && err.code === "MAINNET_REFUSED",
    );
  }, 42161);
});

test("sepolia script deploys the protocol on local chain 421614", { timeout: 120_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const manifest = await broadcastSepolia({
      SEPOLIA_RPC: rpc,
      LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
      DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
      PARTNER_A_ADDRESS: ROLES.partnerA.address,
      PARTNER_B_ADDRESS: ROLES.partnerB.address,
    }, manifestFile);
    assert.equal(manifest.chainId, 421614);
    assert.equal(manifest.mode, "protocol");
    assert.equal(manifest.factory.toLowerCase(), "0x5fbdb2315678afecb367f032d93f642f64180aa3");
    const client = createPublicClient({ chain: foundry, transport: http(rpc) });
    const names = ["MockUSDG", "LockgateCreditLine", "FundFactory", "LockgateExitPool", "PartnerVaultA"] as const;
    for (const name of names) assert.match(manifest.contracts[name] ?? "", /^0x[0-9a-fA-F]{40}$/);
    assert.equal(new Set(names.map((name) => manifest.contracts[name]?.toLowerCase())).size, names.length);
    const vault = manifest.contracts.PartnerVaultA ?? "";
    const proxy = await client.getBytecode({ address: vault as `0x${string}` });
    assert.equal(proxy?.toLowerCase(), loadDeployedBytecode("ERC1967Proxy").bytecode.toLowerCase());
    const factoryCode = await client.getBytecode({ address: manifest.factory as `0x${string}` });
    assert.equal(factoryCode?.toLowerCase(), loadDeployedBytecode("Create2Factory").bytecode.toLowerCase());
    assert.notEqual(manifest.contracts.PartnerVaultA.toLowerCase(), manifest.roles.deployer.toLowerCase());
    assert.equal(manifest.roles.partnerA.toLowerCase(), ROLES.partnerA.address.toLowerCase());
    assert.equal(manifest.roles.governor.toLowerCase(), ROLES.partnerA.address.toLowerCase());
  }, 421614);
});

test("sepolia script refuses a governor equal to the deployer", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc) => {
    await assert.rejects(
      () => broadcastSepolia({
        SEPOLIA_RPC: rpc,
        LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
        DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
        GOVERNOR_ADDRESS: ROLES.lockgate.address,
        PARTNER_A_ADDRESS: ROLES.partnerA.address,
        PARTNER_B_ADDRESS: ROLES.partnerB.address,
      }, "/tmp/lockgate-sepolia-governor.json"),
      (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
    );
  }, 421614);
});
