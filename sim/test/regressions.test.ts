import assert from "node:assert/strict";
import { test } from "node:test";
import { regressions } from "../src/regressions.js";

test("the catalog names every sim bug once", () => {
  const ids = regressions.map((row) => row.id);
  assert.deepEqual(ids, ["T-1", "T-2", "T-3", "T-8", "front-run-repay"]);
  assert.equal(new Set(regressions.map((row) => row.name)).size, regressions.length);
});

for (const row of regressions) {
  test(`${row.id} ${row.name}`, () => {
    row.repro();
  });
}
