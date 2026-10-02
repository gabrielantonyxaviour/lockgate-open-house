import assert from "node:assert/strict";
import { test } from "node:test";
import { deployNew, send, type Ctx } from "../src/chain.js";
import { HarnessError } from "../src/errors.js";
import { attachTiming, noteGas, runReported, type Meter } from "../src/summary.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOYED = "0x00000000000000000000000000000000000000aa";

test("a reported action adds elapsed milliseconds and the summed receipt gas", async () => {
  const ticks = [1_000, 1_250];
  let tick = 0;
  const ctx = fake([21_000n, 100n]);
  const reported = await runReported(ctx, async () => {
    await send(ctx, "lockgate", "MockUSDG", "faucet", [1n]);
    const hash = await send(ctx, "lockgate", "MockUSDG", "faucet", [1n]);
    return { hash, amount: "1000" };
  }, () => ticks[tick++] ?? 1_250);
  assert.deepEqual(reported, {
    hash: hashAt(2),
    amount: "1000",
    timing: { elapsedMs: 250, gasUsed: "21100" },
  });
  assert.equal(JSON.stringify(reported).includes("0x[redacted]"), false);
});

test("the next action starts its gas total at zero", async () => {
  const ctx = fake([21_000n]);
  await runReported(ctx, () => send(ctx, "lockgate", "MockUSDG", "faucet", [1n]), () => 10);
  const reported = await runReported(ctx, async () => ({ amount: "0" }), () => 20) as { timing: { gasUsed: string; elapsedMs: number } };
  assert.deepEqual(reported.timing, { elapsedMs: 0, gasUsed: "0" });
});

test("a deploy receipt is included in the same gas total", async () => {
  const ctx = fake([50_000n], { contractAddress: DEPLOYED });
  const address = await deployNew(ctx, "platform", "MockUSDG", []);
  assert.equal(address, DEPLOYED);
  assert.equal(ctx.meter.gas, 54_000n);
});

test("a send that never gets a receipt adds no gas", async () => {
  const ctx = fake([], { fail: true });
  await assert.rejects(
    () => runReported(ctx, () => send(ctx, "lockgate", "MockUSDG", "faucet", [1n]), () => 5),
    (err) => err instanceof HarnessError && err.code === "RPC" && err.message === "rpc down",
  );
  assert.equal(ctx.meter.gas, 0n);
});

test("timing keeps the action fields and refuses a broken clock or a second timing", () => {
  const input = { amount: "1000" };
  const reported = attachTiming(input, 1_000, 21_000n, 1_250);
  assert.equal("timing" in input, false);
  assert.deepEqual(reported, { amount: "1000", timing: { elapsedMs: 250, gasUsed: "21000" } });
  assert.deepEqual(attachTiming(["row"], 0, 0n, 0), { result: ["row"], timing: { elapsedMs: 0, gasUsed: "0" } });
  assert.throws(() => attachTiming(input, 5, 0n, 4), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.throws(() => attachTiming({ timing: { elapsedMs: 1, gasUsed: "1" } }, 0, 0n, 0), (err) => err instanceof HarnessError && err.code === "VALIDATION");
  assert.throws(() => noteGas({ gas: 0n }, -1n), (err) => err instanceof HarnessError && err.code === "VALIDATION");
});

function hashAt(n: number): string {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

function fake(gas: bigint[], opts: { fail?: boolean; contractAddress?: string } = {}): Ctx & { meter: Meter } {
  let sent = 0;
  const meter: Meter = { gas: 4_000n };
  return {
    chainId: 31337,
    meter,
    binding: () => ({ abi: [], address: ZERO }),
    wallet: () => ({
      account: { address: ZERO },
      writeContract: async () => {
        sent += 1;
        if (opts.fail) throw new Error("rpc down");
        return hashAt(sent);
      },
      deployContract: async () => {
        sent += 1;
        return hashAt(sent);
      },
    }),
    publicClient: {
      waitForTransactionReceipt: async () => ({ gasUsed: gas[sent - 1], contractAddress: opts.contractAddress ?? null }),
    },
  } as unknown as Ctx & { meter: Meter };
}
