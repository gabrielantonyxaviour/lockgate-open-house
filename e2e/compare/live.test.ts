import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compared, runCompare } from "../src/compare.ts";
import { render } from "../src/diverge.ts";

test("an engine proposal funded on Anvil matches the signature and is priced apart from the sim", async () => {
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
  const fee = divergences.find((item) => item.id === "fee-bps-600s");
  assert.ok(fee);
  assert.equal(sheet.engine.bps, 101);
  assert.equal(sheet.chain.bps, 99);
  assert.equal(sheet.sim.bps, 98);
  assert.match(fee.sim, /98 bps/);
  assert.match(fee.engine, /101 bps/);
  assert.match(fee.chain, /99 bps/);
  assert.equal(sheet.funded.vaultFee, sheet.engine.fee);
  assert.equal(sheet.funded.lockgate, 0n);
  assert.equal(written.includes(`${sheet.sim.bps} bps`), true);
  assert.equal(written.includes(`${sheet.engine.bps} bps`), true);
  assert.equal(written.includes(`${sheet.chain.bps} bps`), true);
});
