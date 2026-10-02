import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { test } from "node:test";
import { demoAll, demoStage1 } from "../src/actions/demo.js";
import { books } from "../src/actions/stage3.js";
import { depositCapital, postReserve, registerPlatform, requestRedeem } from "../src/actions/stage1.js";
import { loadCtx, read, type Ctx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { readManifest } from "../src/manifest.js";
import { cursorPath } from "../src/progress.js";
import { parseUsdg } from "../src/units.js";
import { withAnvil } from "./anvil.js";

test("a partial stage 1 resumes without a second deposit", { timeout: 300_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    await registerPlatform(ctx, { kind: "1", limitUsdg: "25000", reserveBps: "750", initialShares: "1100" });
    await depositCapital(ctx, { amountUsdg: "100000" });
    await postReserve(ctx, { amountUsdg: "2000" });
    await requestRedeem(ctx, { shares: "100" });
    const capitalBefore = await read<bigint>(ctx, "LockgateCreditLine", "capital");
    await demoStage1(ctx);
    const weekly = ctx.binding("WeeklyQueuePlatform").address;
    const capitalAfter = await read<bigint>(ctx, "LockgateCreditLine", "capital");
    assert.equal(capitalBefore, parseUsdg("100000"));
    assert.ok(capitalAfter < capitalBefore);
    assert.ok(capitalBefore - capitalAfter < parseUsdg("10000"));
    assert.equal(await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [weekly]), 0n);
    assert.equal(await read<bigint>(ctx, "WeeklyQueuePlatform", "requestCount"), 3n);
    const block = await ctx.publicClient.getBlockNumber();
    await demoStage1(ctx);
    assert.equal(await ctx.publicClient.getBlockNumber(), block);

    const first = await demoAll(ctx);
    const mid = await ctx.publicClient.getBlockNumber();
    const second = await demoAll(ctx);
    assert.deepEqual(second, first);
    assert.equal(await ctx.publicClient.getBlockNumber(), mid);
    const picture = await economics(ctx);
    unlinkSync(cursorPath(manifestFile));
    await demoAll(ctx);
    assert.equal(await ctx.publicClient.getBlockNumber(), mid);
    assert.deepEqual(await economics(ctx), picture);
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
