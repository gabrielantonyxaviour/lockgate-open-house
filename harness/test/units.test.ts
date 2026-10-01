import assert from "node:assert/strict";
import { test } from "node:test";
import { ARBITRUM_ONE, ARBITRUM_SEPOLIA, assertHarnessWrite, assertSepoliaBroadcast } from "../src/guards.js";
import { feeFromBps, modelFeeBps } from "../src/model.js";
import { formatUsdg, parseBps, parseUsdg } from "../src/units.js";
import { HarnessError } from "../src/errors.js";

test("USDG parsing keeps 6 decimals", () => {
  assert.equal(parseUsdg("1000"), 1_000_000_000n);
  assert.equal(parseUsdg("102.34"), 102_340_000n);
  assert.equal(formatUsdg(102_340_000n), "102.34");
  assert.equal(parseBps("750"), 750);
  assert.throws(() => parseUsdg("1.1234567"), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.throws(() => parseBps("10001"), (err) => err instanceof HarnessError);
});

test("stage-1 curve prices a 600 second demo window at 99 bps", () => {
  assert.equal(modelFeeBps(600n), 99);
  assert.equal(feeFromBps(1_000_000_000n, 99), 9_900_000n);
});

test("writes refuse every chain except local Anvil", () => {
  assert.doesNotThrow(() => assertHarnessWrite(31337));
  assert.throws(() => assertHarnessWrite(ARBITRUM_ONE), (err) => err instanceof HarnessError && err.code === "MAINNET_REFUSED");
  assert.throws(() => assertHarnessWrite(ARBITRUM_SEPOLIA), (err) => err instanceof HarnessError && err.code === "CHAIN_REFUSED");
});

test("Sepolia broadcast refuses mainnet and an unflagged testnet", () => {
  assert.throws(() => assertSepoliaBroadcast(ARBITRUM_ONE, { LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1", DEPLOYER_PRIVATE_KEY: `0x${"11".repeat(32)}` }), (err) => err instanceof HarnessError && err.code === "MAINNET_REFUSED");
  assert.throws(() => assertSepoliaBroadcast(ARBITRUM_SEPOLIA, {}), (err) => err instanceof HarnessError && err.code === "SEPOLIA_BLOCKED");
  assert.throws(() => assertSepoliaBroadcast(ARBITRUM_SEPOLIA, { LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1" }), (err) => err instanceof HarnessError && err.code === "MISSING_ENV");
  const key = assertSepoliaBroadcast(ARBITRUM_SEPOLIA, { LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1", DEPLOYER_PRIVATE_KEY: `0x${"ab".repeat(32)}` });
  assert.equal(key.length, 66);
});
