import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCtx, read, send } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { LINE_CAPS } from "../src/params.js";
import { ROLES } from "../src/roles.js";
import { withAnvil } from "./anvil.js";

test("deploy sets the line caps and only Lockgate can create platforms", { timeout: 180_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const ctx = await loadCtx(await deployProtocol(rpc, manifestFile), manifestFile);
    assert.equal(Number(await read(ctx, "LockgateCreditLine", "maxUtilizationBps")), LINE_CAPS.utilizationBps);
    assert.equal(Number(await read(ctx, "LockgateCreditLine", "maxConcentrationBps")), LINE_CAPS.concentrationBps);
    assert.ok(LINE_CAPS.utilizationBps < 10_000);
    await assert.rejects(
      send(ctx, "platform", "FundFactory", "createPlatform", [1, "Drain", 600n, 1_000_000n, ROLES.platform.address, 10n ** 30n, 0]),
    );
    await assert.rejects(send(ctx, "platform", "FundFactory", "createDemoFund", ["Drain", ROLES.platform.address]));
  });
});
