import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { isContractRevert, solidityTreeMtime } from "../src/chain.ts";
import { zAmount } from "../src/engine.ts";

test("a transport error is not counted as a revert", () => {
  assert.equal(isContractRevert(new Error("connect ECONNREFUSED")), false);
  assert.equal(isContractRevert(new BaseError("HTTP request failed")), false);
  assert.equal(isContractRevert(new BaseError("execution reverted")), true);
  const reverted = new ContractFunctionRevertedError({ abi: [], functionName: "draw", message: "Covenant" });
  const wrapped = new BaseError("contract call failed", { cause: reverted });
  assert.equal(wrapped.message.toLowerCase().includes("reverted"), false);
  assert.equal(isContractRevert(wrapped), true);
});

test("freshness follows a nested source, not only the contract file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lockgate-stamp-"));
  mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  const older = path.join(root, "src", "Token.sol");
  const newer = path.join(root, "src", "nested", "Lib.sol");
  writeFileSync(older, "contract Token {}");
  writeFileSync(newer, "contract Lib {}");
  const noise = path.join(root, "src", "notes.txt");
  writeFileSync(noise, "notes");
  const past = new Date("2020-01-01T00:00:00Z");
  const recent = new Date("2024-01-01T00:00:00Z");
  const future = new Date("2026-01-01T00:00:00Z");
  utimesSync(older, past, past);
  utimesSync(newer, recent, recent);
  utimesSync(noise, future, future);
  const stamp = solidityTreeMtime(root);
  assert.equal(stamp, statSync(newer).mtimeMs);
  assert.ok(stamp < statSync(noise).mtimeMs);
});

test("a json number above 2^53 is not an amount", () => {
  const exact = "9007199254740993";
  const rounded = JSON.parse(exact) as number;
  assert.notEqual(String(rounded), exact);
  assert.throws(() => zAmount.parse(rounded));
  assert.throws(() => zAmount.parse(100));
  assert.equal(zAmount.parse(exact), 9_007_199_254_740_993n);
  assert.equal(zAmount.parse(String(rounded)), BigInt(rounded));
  assert.notEqual(zAmount.parse(String(rounded)), zAmount.parse(exact));
  assert.equal(zAmount.parse(9_007_199_254_740_992n), 9_007_199_254_740_992n);
});
