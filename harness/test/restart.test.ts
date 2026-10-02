import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { demoStage1 } from "../src/actions/demo.js";
import { registerPlatform } from "../src/actions/stage1.js";
import { loadCtx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { failureBody, HarnessError } from "../src/errors.js";
import { readManifest } from "../src/manifest.js";
import { cursorPath, runStep } from "../src/progress.js";
import { openAnvil } from "./anvil.js";

test("a restarted Anvil does not replay the cursor and the demo can run again", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-restart-"));
  const manifestFile = join(dir, "manifest.json");
  const cursor = cursorPath(manifestFile);
  let node = await openAnvil();
  try {
    await deployProtocol(node.rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    const started = await runStep(ctx, "stage1", () => registerPlatform(ctx, {
      kind: "1",
      limitUsdg: "25000",
      reserveBps: "750",
      initialShares: "1100",
    }));
    const sealed = readFileSync(cursor, "utf8");
    const manifestBytes = readFileSync(manifestFile, "utf8");
    assert.equal(sealed.includes("stage1"), true);

    await node.stop();
    await expectFailure(() => demoStage1(ctx), "RPC", "RPC is unreachable");
    assert.equal(readFileSync(cursor, "utf8"), sealed);
    assert.equal(readFileSync(manifestFile, "utf8"), manifestBytes);

    node = await openAnvil(node.port);
    await expectFailure(() => demoStage1(ctx), "NOT_DEPLOYED", "Manifest contracts are not on this chain");
    assert.equal(readFileSync(cursor, "utf8"), sealed);
    assert.equal(readFileSync(manifestFile, "utf8"), manifestBytes);

    await deployProtocol(node.rpc, manifestFile);
    const fresh = await loadCtx(readManifest(manifestFile), manifestFile);
    const first = await demoStage1(fresh);
    assert.notDeepEqual(first, started);
    assert.match(lateAdvance(first), /^\d+$/);
    const block = await fresh.publicClient.getBlockNumber();
    const second = await demoStage1(fresh);
    assert.deepEqual(second, first);
    assert.equal(await fresh.publicClient.getBlockNumber(), block);
    assert.notEqual(readFileSync(cursor, "utf8"), sealed);
  } finally {
    await node.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

function lateAdvance(result: unknown): string {
  const row = result as { lateAdvance?: unknown };
  assert.equal(typeof row.lateAdvance, "string");
  return row.lateAdvance as string;
}

async function expectFailure(fn: () => Promise<unknown>, code: string, message: string): Promise<void> {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof HarnessError);
    assert.equal(err.code, code);
    assert.equal(err.message, message);
    const body = failureBody(err);
    assert.deepEqual(Object.keys(body), ["error", "code"]);
    assert.equal(body.error, message);
    assert.equal(body.error.includes(" at "), false);
    assert.equal(/[0-9a-fA-F]{64}/.test(body.error), false);
    return true;
  });
}
