import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";
import { readKasu } from "../src/adapters/kasu/read.js";
import { readMaple } from "../src/adapters/maple/read.js";
import { ADAPTER_POLICY, withPolicy, type ReadPolicy } from "../src/adapters/policy.js";
import type { ContractReader } from "../src/adapters/reader.js";
import { readUsdai } from "../src/adapters/usdai/read.js";
import type { Address } from "../src/domain.js";

const ADDR = "0x00000000000000000000000000000000000000aa" as Address;
const CALL = { address: ADDR, abi: [] as const, functionName: "ping" };

const TIGHT: ReadPolicy = { burst: 2, intervalMs: 1_000, attempts: 1, backoffMs: 0 };
const RETRY: ReadPolicy = { burst: 8, intervalMs: 60_000, attempts: 3, backoffMs: 200 };

function limited(): Error {
  return Object.assign(new Error("too many requests"), { status: 429 });
}

function scripted(fails: number, answers: Record<string, unknown>): { reader: ContractReader; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    reader: {
      async readContract({ functionName }) {
        n += 1;
        if (n <= fails) throw limited();
        const value = answers[functionName];
        if (value === undefined) throw new Error(String(functionName));
        return value;
      },
    },
  };
}

async function retryThen<T>(start: () => Promise<T>, calls: () => number, done: number): Promise<T> {
  const pending = start();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls()).toBe(1);
  await vi.advanceTimersByTimeAsync(ADAPTER_POLICY.backoffMs - 1);
  expect(calls()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls()).toBe(2);
  await vi.advanceTimersByTimeAsync(ADAPTER_POLICY.backoffMs * 2 - 1);
  expect(calls()).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls()).toBe(done);
  return pending;
}

describe("adapter rate limit and retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the burst immediately and spaces the next call", async () => {
    const times: number[] = [];
    const paced = withPolicy({
      async readContract() {
        times.push(Date.now());
        return 1n;
      },
    }, TIGHT);
    await paced.readContract(CALL);
    await paced.readContract(CALL);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBe(0);
    let third = false;
    const pending = paced.readContract(CALL).then(() => {
      third = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(third).toBe(false);
    expect(times).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(3);
    expect(times[2]! - times[1]!).toBe(1_000);
    await pending;
  });

  it("does not wait when the interval is 0", async () => {
    let calls = 0;
    const paced = withPolicy({
      async readContract() {
        calls += 1;
        return 1n;
      },
    }, { burst: 1, intervalMs: 0, attempts: 1, backoffMs: 0 });
    await paced.readContract(CALL);
    await paced.readContract(CALL);
    await paced.readContract(CALL);
    expect(calls).toBe(3);
  });

  it("retries a 429 on the backoff schedule and stops after the last attempt", async () => {
    let calls = 0;
    const paced = withPolicy({
      async readContract() {
        calls += 1;
        throw limited();
      },
    }, RETRY);
    const pending = paced.readContract(CALL);
    const settled = pending.then(
      () => "ok" as const,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("too many requests");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(3);
  });

  it("does not retry a decode error", async () => {
    let calls = 0;
    const paced = withPolicy({
      async readContract() {
        calls += 1;
        throw new Error("missing request");
      },
    }, RETRY);
    await expect(paced.readContract(CALL)).rejects.toThrow("missing request");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  });

  it("rejects a burst outside 1 to 256", () => {
    const reader: ContractReader = { async readContract() { return 1n; } };
    expect(() => withPolicy(reader, { ...ADAPTER_POLICY, burst: 0 })).toThrow(/adapter burst/);
  });

  it("retries Kasu, Maple, and sUSDai on the default backoff", async () => {
    const kasu = scripted(2, {
      currentEpochNumber: 4n,
      epochDuration: 604_800n,
      clearingPeriodLength: 172_800n,
      epochStartTimestamp: 1_700_000_000n,
      isClearingTime: false,
      totalSupply: 0n,
    });
    const seen = await retryThen(
      () => readKasu(kasu.reader, { systemVariables: ADDR, pendingPool: ADDR }),
      kasu.calls,
      8,
    );
    expect(seen.queuedValue).toBe(0n);
    expect(seen.poolDecimals).toBe(6);

    const maple = scripted(2, { queue: [1n, 0n], decimals: 6, totalAssets: 0n });
    const book = await retryThen(
      () => readMaple(maple.reader, { pool: ADDR, withdrawalManager: ADDR, asset: ADDR }),
      maple.calls,
      5,
    );
    expect(book.cashKnown).toBe(false);

    const usdai = scripted(2, {
      redemptionQueueInfo: [0n, 0n, 0n, 0n, 0n],
      redemptionSharePrice: 10n ** 18n,
      nav: 0n,
      redemptionTimestamp: 1_700_000_000n,
      decimals: 6,
    });
    const queue = await retryThen(
      () => readUsdai(usdai.reader, { staked: ADDR, asset: ADDR }, 1_700_000_000),
      usdai.calls,
      7,
    );
    expect(queue.kind).toBe("epoch");
  });

  it("hides the transport body after the Kasu retries are spent", async () => {
    let calls = 0;
    const reader: ContractReader = {
      async readContract() {
        calls += 1;
        throw new HttpRequestError({
          url: "http://127.0.0.1:9/adapter-retry-secret",
          body: { leak: "adapter-retry-body" },
          status: 429,
        });
      },
    };
    const pending = readKasu(reader, { systemVariables: ADDR, pendingPool: ADDR });
    const settled = pending.then(
      () => undefined,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(ADAPTER_POLICY.backoffMs + ADAPTER_POLICY.backoffMs * 2);
    const err = await settled;
    expect(err).toMatchObject({ code: "rpc", message: "rpc request failed" });
    expect(calls).toBe(ADAPTER_POLICY.attempts);
    const encoded = JSON.stringify(err);
    expect(encoded).not.toContain("127.0.0.1");
    expect(encoded).not.toContain("adapter-retry");
    expect(encoded).not.toContain("stack");
  });
});
