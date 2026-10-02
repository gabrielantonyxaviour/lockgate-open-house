import assert from "node:assert/strict";
import { test } from "node:test";
import { type WalletClient } from "viem";
import { assertProposalShape, signProposal, type AdvanceProposal } from "../src/eip712.js";
import { HarnessError } from "../src/errors.js";
import { ARBITRUM_ONE, ARBITRUM_SEPOLIA, assertAnvilPort, assertLocalRpc } from "../src/guards.js";
import { feeFromBps, modelFeeBps } from "../src/model.js";
import { startServer } from "../src/server.js";
import { inOrder } from "../src/turnstile.js";
import { type Ctx } from "../src/chain.js";

test("loopback is required and port 8545 is reserved", () => {
  assert.doesNotThrow(() => assertLocalRpc("http://127.0.0.1:8546"));
  assert.doesNotThrow(() => assertLocalRpc("http://localhost:18910"));
  assert.throws(() => assertLocalRpc("http://127.0.0.1:8545"), (err) => err instanceof HarnessError && err.code === "PORT_RESERVED");
  assert.throws(() => assertLocalRpc("http://127.0.0.1:08545"), (err) => err instanceof HarnessError && err.code === "PORT_RESERVED");
  assert.throws(() => assertLocalRpc("http://127.0.0.1"), (err) => err instanceof HarnessError && err.code === "CHAIN_REFUSED");
  assert.throws(() => assertLocalRpc("https://sepolia-rollup.arbitrum.io/rpc"), (err) => err instanceof HarnessError && err.code === "CHAIN_REFUSED");
  assert.throws(() => assertLocalRpc("http://1.2.3.4:8546"), (err) => err instanceof HarnessError && err.code === "CHAIN_REFUSED");
});

test("anvil port text cannot sneak onto 8545", () => {
  assert.equal(assertAnvilPort("8546"), 8546);
  assert.throws(() => assertAnvilPort("8545"), (err) => err instanceof HarnessError && err.code === "PORT_RESERVED");
  assert.throws(() => assertAnvilPort("08545"), (err) => err instanceof HarnessError && err.code === "PORT_RESERVED");
  assert.throws(() => assertAnvilPort("80"), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.throws(() => assertAnvilPort("8546 "), (err) => err instanceof HarnessError && err.code === "VALIDATION");
});

test("signatures are refused off local Anvil and a zero payout is refused", async () => {
  const proposal = sample();
  await assert.rejects(
    () => signProposal({} as WalletClient, proposal, ARBITRUM_ONE, proposal.platform),
    (err: unknown) => err instanceof HarnessError && err.code === "MAINNET_REFUSED",
  );
  await assert.rejects(
    () => signProposal({} as WalletClient, proposal, ARBITRUM_SEPOLIA, proposal.platform),
    (err: unknown) => err instanceof HarnessError && err.code === "CHAIN_REFUSED",
  );
  assert.throws(() => assertProposalShape({ ...proposal, fee: proposal.navValue, payout: 0n }), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.throws(() => assertProposalShape({ ...proposal, payout: proposal.payout - 1n }), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.doesNotThrow(() => assertProposalShape(proposal));
});

test("stage-1 fee stays on the ceiling and the curve is not clamped", () => {
  assert.equal(feeFromBps(10_001n, 1), 2n);
  assert.equal(feeFromBps(1n, 1), 1n);
  assert.equal(modelFeeBps(300n), 49);
  assert.equal(modelFeeBps(86_400n), 14_203);
});

test("acts run one at a time", async () => {
  const order: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = inOrder(async () => {
    order.push("first-start");
    await gate;
    order.push("first-end");
  });
  const second = inOrder(async () => { order.push("second"); });
  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  release();
  await first;
  await second;
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("the act route rejects numbers and oversized bodies before a chain call", async () => {
  const server = await startServer({} as Ctx, 0);
  try {
    const numeric = await post(server.url, JSON.stringify({ action: "stage1.quote", input: { navUsdg: 9007199254740993 } }));
    assert.equal(numeric.status, 400);
    assert.equal(numeric.body.code, "VALIDATION");
    const huge = await post(server.url, `{"action":"read.status","input":{"blob":"${"a".repeat(9_000)}"}}`);
    assert.equal(huge.status, 400);
    assert.equal(huge.body.code, "VALIDATION");
  } finally {
    await server.close();
  }
});

function sample(): AdvanceProposal {
  return {
    platform: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    requestId: 1n,
    navValue: 1_000_000n,
    fee: 2_500n,
    payout: 997_500n,
    feeBps: 25,
    dueAt: 3_600n,
    expiresAt: 86_400n,
    nonce: 1n,
    quoteId: `0x${"11".repeat(32)}`,
  };
}

async function post(url: string, body: string): Promise<{ status: number; body: { code?: string } }> {
  const response = await fetch(`${url}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return { status: response.status, body: await response.json() as { code?: string } };
}
