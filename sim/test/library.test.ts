import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLibrary, scenarioLibrary } from "../src/library.js";

const IDS = [
  "stage1-happy",
  "stage2-happy",
  "stage3-happy",
  "gated",
  "stale-nav",
  "tenor",
  "reserve-short",
  "capital-short",
  "mandate-platform",
  "mandate-fee",
  "mandate-tenor",
  "front-run-repay",
  "junior-before-senior",
] as const;

test("the library names three happy paths and ten failures", () => {
  const rows = scenarioLibrary();
  assert.deepEqual(rows.map((row) => row.id), [...IDS]);
  assert.equal(rows.filter((row) => row.kind === "happy").length, 3);
  assert.equal(rows.filter((row) => row.kind === "failure").length, 10);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  for (const stage of ["stage1", "stage2", "stage3"] as const) {
    assert.equal(rows.filter((row) => row.stage === stage && row.kind === "happy").length, 1);
    assert.ok(rows.some((row) => row.stage === stage && row.kind === "failure"));
  }
  for (const row of rows) {
    assert.equal(row.expect.includes("|"), false);
    assert.ok(row.title.length > 0);
    assert.ok(row.expect.length > 0);
  }
});

for (const row of scenarioLibrary()) {
  test(`${row.id} ${row.title}`, () => {
    row.run();
  });
}

test("LIBRARY.md matches the renderer", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "LIBRARY.md");
  assert.equal(readFileSync(path, "utf8"), renderLibrary());
});
