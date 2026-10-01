import assert from "node:assert/strict";
import { test } from "node:test";
import { failureBody, HarnessError } from "../src/errors.js";
import { parseAnvilEnv, parseFlags, parseLocalDeployEnv, parseSepoliaEnv, parseSepoliaManifest } from "../src/input.js";
import { ROLES } from "../src/roles.js";
import { broadcastSepolia } from "../src/sepolia.js";
import { withAnvil } from "./anvil.js";

const deadRpc = "http://127.0.0.1:1";

test("a missing deployer key is refused before any RPC", async () => {
  await assert.rejects(
    () => broadcastSepolia({ LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1", SEPOLIA_RPC: deadRpc }, "/tmp/lockgate-missing-key.json"),
    (err: unknown) => {
      const body = failureBody(err);
      return err instanceof HarnessError
        && err.code === "MISSING_ENV"
        && body.code === "MISSING_ENV"
        && !JSON.stringify(body).includes("ac0974");
    },
  );
  assert.throws(
    () => parseSepoliaEnv({ LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1", DEPLOYER_PRIVATE_KEY: "0x1234", SEPOLIA_RPC: deadRpc }),
    (err: unknown) => err instanceof HarnessError && err.code === "MISSING_ENV",
  );
});

test("a bad Sepolia address is refused before any RPC", () => {
  assert.throws(
    () => parseSepoliaEnv({
      LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
      DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
      PARTNER_A_ADDRESS: "0x1234",
      SEPOLIA_RPC: deadRpc,
    }),
    (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION" && !String(err).includes(ROLES.lockgate.key),
  );
});

test("local deploy rejects a public RPC and an empty URL", () => {
  assert.throws(
    () => parseLocalDeployEnv({ HARNESS_RPC: "https://arb1.arbitrum.io/rpc" }),
    (err: unknown) => err instanceof HarnessError && err.code === "CHAIN_REFUSED",
  );
  assert.throws(
    () => parseLocalDeployEnv({ HARNESS_RPC: "http://127.0.0.1:8545" }),
    (err: unknown) => err instanceof HarnessError && err.code === "PORT_RESERVED",
  );
  assert.throws(
    () => parseLocalDeployEnv({ HARNESS_RPC: "" }),
    (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
  );
  assert.throws(() => parseFlags({ navUsdg: "1".repeat(300) }), (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.equal(parseAnvilEnv({}).port, 8546);
  assert.throws(
    () => parseAnvilEnv({ HARNESS_ANVIL_PORT: "8545" }),
    (err: unknown) => err instanceof HarnessError && err.code === "PORT_RESERVED",
  );
  assert.throws(
    () => parseAnvilEnv({ HARNESS_ANVIL_PORT: "nope" }),
    (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION",
  );
  assert.equal(parseSepoliaManifest({}).endsWith("421614.json"), true);
  assert.throws(
    () => parseSepoliaManifest({ SEPOLIA_MANIFEST: "x".repeat(513) }),
    (err: unknown) => err instanceof HarnessError && err.code === "VALIDATION" && !String(err).includes("x".repeat(64)),
  );
});

test("failure output redacts a key and drops the stack", () => {
  const key = `0x${"ab".repeat(32)}`;
  const signature = `0x${"11".repeat(65)}`;
  const body = failureBody(new Error(`revert ${key} sig ${signature}\n    at deploy (sepolia.ts:1:1)`));
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
  assert.equal(body.code, "INTERNAL");
  assert.equal(body.error.includes(key), false);
  assert.match(body.error, /0x\[redacted\]/);
  assert.equal(body.error.includes(signature), true);
  assert.equal(body.error.includes("\n"), false);
  assert.equal(body.error.includes("sepolia.ts"), false);
  const stored = new HarnessError(`paid ${key}`, "REVERT", key);
  const storedBody = stored.toJSON();
  assert.deepEqual(Object.keys(storedBody).sort(), ["code", "error"]);
  assert.equal(stored.message.includes(key), false);
  assert.equal(String(stored.details).includes(key), false);
});

test("a chain id other than 421614 is refused before a transaction", { timeout: 30_000 }, async () => {
  await withAnvil(async (rpc) => {
    await assert.rejects(
      () => broadcastSepolia({
        SEPOLIA_RPC: rpc,
        LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
        DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
      }, "/tmp/lockgate-wrong-chain.json"),
      (err: unknown) => {
        const body = failureBody(err);
        const text = JSON.stringify(body);
        return err instanceof HarnessError
          && body.code === "CHAIN_REFUSED"
          && !text.includes(ROLES.lockgate.key.slice(2));
      },
    );
  }, 1);
});
