import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BaseError } from "viem";
import { isContractRevert, solidityTreeMtime } from "../src/chain.ts";
import { zAmount } from "../src/engine.ts";

test("a transport error is not counted as a revert", () => {
  assert.equal(isContractRevert(new Error("connect ECONNREFUSED")), false);
  assert.equal(isContractRevert(new BaseError("HTTP request failed")), false);
});

test("freshness follows a nested source, not only the contract file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lockgate-stamp-"));
  mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  const older = path.join(root, "src", "Token.sol");
  const newer = path.join(root, "src", "nested", "Lib.sol");
  writeFileSync(older, "contract Token {}");
  writeFileSync(newer, "contract Lib {}");
  const past = new Date("2020-01-01T00:00:00Z");
  const recent = new Date("2024-01-01T00:00:00Z");
  utimesSync(older, past, past);
  utimesSync(newer, recent, recent);
  const stamp = solidityTreeMtime(root);
  assert.ok(stamp >= recent.getTime());
  assert.ok(stamp > past.getTime());
});

test("a json number above 2^53 is not an amount", () => {
  const rounded = JSON.parse("9007199254740993") as number;
  assert.notEqual(String(rounded), "9007199254740993");
  assert.throws(() => zAmount.parse(rounded));
  assert.equal(zAmount.parse("9007199254740993"), 9_007_199_254_740_993n);
  assert.equal(zAmount.parse(9_007_199_254_740_992n), 9_007_199_254_740_992n);
});
