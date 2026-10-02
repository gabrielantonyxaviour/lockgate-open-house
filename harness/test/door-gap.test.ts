import assert from "node:assert/strict";
import { test } from "node:test";
import { demoAll, demoStage1 } from "../src/actions/demo.js";
import { loadCtx, read } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { readManifest } from "../src/manifest.js";
import { ROLES } from "../src/roles.js";
import { withAnvil } from "./anvil.js";

test("stage 1 leaves the open vault unsold and demoAll sells it", { timeout: 300_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    const investor = ROLES.investor.address;
    const sharesBefore = await read<bigint>(ctx, "OpenCreditVault", "balanceOf", [investor]);
    const countBefore = await read<bigint>(ctx, "LockgateExitPool", "positionCount");
    assert.equal(sharesBefore, 0n);
    await demoStage1(ctx);
    assert.equal(await read<bigint>(ctx, "OpenCreditVault", "balanceOf", [investor]), sharesBefore);
    assert.equal(await read<bigint>(ctx, "LockgateExitPool", "positionCount"), countBefore);
    assert.equal(countBefore, 0n);

    await demoAll(ctx);
    const countAfter = await read<bigint>(ctx, "LockgateExitPool", "positionCount");
    assert.equal(countAfter, 1n);
    assert.equal(await read<bigint>(ctx, "OpenCreditVault", "balanceOf", [investor]), 0n);
  });
});
