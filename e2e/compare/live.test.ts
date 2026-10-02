import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compared, runCompare } from "../src/compare.ts";
import { render } from "../src/diverge.ts";

test("an engine proposal funded on Anvil matches the signature, and sim, engine and chain price it the same", async () => {
  const sheet = await runCompare();
  const { breaks, divergences } = compared(sheet);
  const written = render(sheet, breaks, divergences);
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../DIVERGENCE.md");
  writeFileSync(file, written);
  assert.deepEqual(
    breaks.map((item) => item.id),
    [],
    breaks.map((item) => item.what).join("; "),
  );
  assert.deepEqual(divergences.map((item) => item.id), [], divergences.map((item) => `${item.id}: ${item.what}`).join("; "));
  assert.equal(sheet.engine.bps, sheet.chain.bps);
  assert.equal(sheet.sim.bps, sheet.chain.bps);
  assert.equal(sheet.engine.fee, sheet.chain.fee);
  assert.equal(sheet.sim.fee, sheet.chain.fee);
  assert.equal(sheet.funded.vaultFee, sheet.engine.fee);
  assert.equal(sheet.funded.lockgate, 0n);
  assert.equal(written.includes(`${sheet.sim.bps} bps`), true);
  assert.equal(written.includes(`${sheet.engine.bps} bps`), true);
  assert.equal(written.includes(`${sheet.chain.bps} bps`), true);
});
