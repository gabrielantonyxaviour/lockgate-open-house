import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { loadCtx } from "../src/chain.js";
import { HarnessError } from "../src/errors.js";
import { writeManifest } from "../src/manifest.js";
import { cursorPath, runStep } from "../src/progress.js";
import { withAnvil } from "./anvil.js";

test("demo cursor replays a saved step and drops a stale block", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const manifest = {
      mode: "protocol" as const,
      chainId: 31337,
      rpc,
      artifactRoot: "harness",
      factory: "0x0000000000000000000000000000000000000001",
      contracts: {},
      roles: {},
    };
    writeManifest(manifest, manifestFile);
    const ctx = await loadCtx(manifest, manifestFile);
    let runs = 0;
    const first = await runStep(ctx, "stage1", async () => {
      runs += 1;
      return { ran: true };
    });
    const second = await runStep(ctx, "stage1", async () => {
      runs += 1;
      return { ran: false };
    });
    assert.equal(runs, 1);
    assert.deepEqual(second, first);

    const path = cursorPath(manifestFile);
    const saved = JSON.parse(readFileSync(path, "utf8")) as { steps: { stage1: { blockHash: string } } };
    saved.steps.stage1.blockHash = `0x${"ab".repeat(32)}`;
    writeFileSync(path, JSON.stringify(saved));
    const third = await runStep(ctx, "stage1", async () => {
      runs += 1;
      return { ran: "again" };
    });
    assert.equal(runs, 2);
    assert.deepEqual(third, { ran: "again" });

    writeFileSync(path, "{");
    const fourth = await runStep(ctx, "stage1", async () => {
      runs += 1;
      return { ran: "fresh" };
    });
    assert.equal(runs, 3);
    assert.deepEqual(fourth, { ran: "fresh" });

    const body = JSON.parse(readFileSync(path, "utf8")) as { steps: Record<string, unknown> };
    body.steps.stage3 = body.steps.stage1;
    delete body.steps.stage1;
    writeFileSync(path, JSON.stringify(body));
    let stage3 = 0;
    await runStep(ctx, "stage3", async () => {
      stage3 += 1;
      return { stage: 3 };
    });
    assert.equal(stage3, 1);

    await assert.rejects(
      () => runStep(ctx, "missing", async () => ({})),
      (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
    );
  });
});
