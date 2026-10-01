import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { demoAll } from "../src/actions/demo.js";
import { loadCtx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { HarnessError } from "../src/errors.js";
import { readManifest } from "../src/manifest.js";
import { ROLES } from "../src/roles.js";
import { startServer } from "../src/server.js";
import { withAnvil } from "./anvil.js";

test("two fresh Anvil chains deploy the same protocol addresses", { timeout: 180_000 }, async () => {
  const first = await withAnvil(async (rpc, manifestFile) => deployProtocol(rpc, manifestFile));
  const second = await withAnvil(async (rpc, manifestFile) => deployProtocol(rpc, manifestFile));
  assert.equal(first.mode, "protocol");
  assert.equal(first.contracts.MockUSDG, second.contracts.MockUSDG);
  assert.equal(first.contracts.LockgateCreditLine, second.contracts.LockgateCreditLine);
  assert.equal(first.contracts.PartnerVaultA, second.contracts.PartnerVaultA);
  assert.equal(first.contracts.PartnerVaultB, second.contracts.PartnerVaultB);
  assert.equal(first.contracts.CreditFacility, second.contracts.CreditFacility);
  assert.equal(first.contracts.FundFactory, second.contracts.FundFactory);
  assert.equal(first.contracts.OpenCreditVault, second.contracts.OpenCreditVault);
  assert.equal(first.contracts.LockgateExitPool, second.contracts.LockgateExitPool);
  assert.notEqual(first.contracts.PartnerVaultA.toLowerCase(), first.roles.lockgate.toLowerCase());
  assert.notEqual(first.contracts.FundFactory.toLowerCase(), first.contracts.WeeklyImpl.toLowerCase());
});

test("a refused deploy leaves the manifest file untouched", { timeout: 60_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const account = privateKeyToAccount(ROLES.lockgate.key);
    const wallet = createWalletClient({ account, chain: foundry, transport: http(rpc) });
    const hash = await wallet.sendTransaction({ account, chain: foundry, to: account.address, value: 0n });
    const publicClient = createPublicClient({ chain: foundry, transport: http(rpc) });
    await publicClient.waitForTransactionReceipt({ hash });
    const sentinel = "{\"sentinel\":true}\n";
    writeFileSync(manifestFile, sentinel);
    await assert.rejects(
      () => deployProtocol(rpc, manifestFile),
      (err: unknown) => err instanceof HarnessError && err.code === "NOT_FRESH",
    );
    assert.equal(readFileSync(manifestFile, "utf8"), sentinel);
  });
});

test("demo flows and the test console run on local Anvil", { timeout: 300_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const manifest = await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    const server = await startServer(ctx, 0);
    try {
      const page = await fetch(server.url);
      const html = await page.text();
      assert.match(html, /Lockgate test console/);
      assert.match(html, /not the product/);
      assert.match(html, /not an offer/);
      const surface = await (await fetch(`${server.url}/api/surface`)).json() as { mode: string; actions: Array<{ id: string }> };
      assert.equal(surface.mode, "protocol");
      assert.ok(surface.actions.some((action) => action.id === "stage2.routedAdvance"));
      assert.ok(surface.actions.some((action) => action.id === "stage2.approve"));
      assert.ok(surface.actions.some((action) => action.id === "door2.cycle"));
      const faucet = await fetch(`${server.url}/api/act`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "token.faucet", input: { role: "investor", amountUsdg: "1" } }),
      });
      assert.equal(faucet.status, 200);
      const body = await faucet.json() as { ok: boolean };
      assert.equal(body.ok, true);
      const refused = await fetch(`${server.url}/api/act`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "missing" }),
      });
      assert.equal(refused.status, 422);
      const result = await demoAll(ctx);
      assert.ok(result);
      assert.equal(manifest.chainId, 31337);
    } finally {
      await server.close();
    }
  });
});
