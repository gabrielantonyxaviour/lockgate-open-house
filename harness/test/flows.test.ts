import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { demoAll } from "../src/actions/demo.js";
import { books } from "../src/actions/stage3.js";
import { loadCtx, read, type Ctx } from "../src/chain.js";
import { cursorPath } from "../src/progress.js";
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
  assert.equal(first.contracts.OpenCreditVault, undefined, "door 2 is not deployed");
  assert.equal(first.contracts.LockgateExitPool, undefined, "door 2 is not deployed");
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
      assert.ok(!surface.actions.some((action) => action.id.startsWith("door2.")));
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
      const report = result as {
        stage1: { lateAdvance: string };
        stage2: { funded: string; roundRobin: string[] };
        stage3: { base: string; juniorAfter: string };
      };
      assert.equal(report.stage1.lateAdvance, "2");
      assert.equal(report.stage2.funded, "PartnerVaultA");
      assert.deepEqual(report.stage2.roundRobin, ["PartnerVaultB", "PartnerVaultA"]);
      assert.match(report.stage3.base, /^[1-9][0-9]+$/);
      assert.match(report.stage3.juniorAfter, /^[1-9][0-9]+$/);
      assert.equal(manifest.chainId, 31337);
      const block = await ctx.publicClient.getBlockNumber();
      const again = await demoAll(ctx);
      assert.deepEqual(again, result);
      assert.equal(await ctx.publicClient.getBlockNumber(), block);
      const picture = await economics(ctx);
      unlinkSync(cursorPath(manifestFile));
      await demoAll(ctx);
      assert.equal(await ctx.publicClient.getBlockNumber(), block);
      assert.deepEqual(await economics(ctx), picture);
    } finally {
      await server.close();
    }
  });
});

async function economics(ctx: Ctx): Promise<{ capital: string; requests: string; idle: string; drawn: string; recovery: boolean }> {
  const state = await books(ctx);
  return {
    capital: (await read<bigint>(ctx, "LockgateCreditLine", "capital")).toString(),
    requests: (await read<bigint>(ctx, "WeeklyQueuePlatform", "requestCount")).toString(),
    idle: (await read<bigint>(ctx, "PartnerVaultA", "idle")).toString(),
    drawn: state.drawn.toString(),
    recovery: state.recovery,
  };
}
