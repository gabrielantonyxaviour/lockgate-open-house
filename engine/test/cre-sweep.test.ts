import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { creSweepEntry, runCreSweep } from "../src/cre/sweep.js";
import { EngineError, isApiError } from "../src/errors.js";
import { parseJson } from "../src/json.js";

const now = 1_700_000_000;
const vault = "0x00000000000000000000000000000000000000c1";
const platform = "0x00000000000000000000000000000000000000b1";
const MOCK_ARBITRUM = getAddress("0xd41263567ddfead91504199b8c6c87371e83ca5d");
const KEYSTONE_ARBITRUM = getAddress("0x76c9cf548b4179F8901cda1f8623568b58215E62");
const MOCK_ETHEREUM = getAddress("0x15fC6ae953E024d975e77382eEeC56A9101f9F88");
const KEYSTONE_ETHEREUM = getAddress("0xF8344CFd5c43616a4366C34E3EEE75af79a74482");

function book(chainId: number, advance: Record<string, unknown> = {}, schedule = "0 */10 * * * *") {
  return {
    chainId,
    now,
    graceSeconds: 86_400,
    schedule,
    advances: [{
      id: "11",
      vault,
      platform,
      navValue: "10000000000",
      dueAt: now - 10_000,
      status: "active",
      cash: "50000000000",
      vaultKind: "own-book",
      ...advance,
    }],
  };
}

describe("CRE sweep simulation", () => {
  it("plans a local repay and leaves the report unsent", () => {
    const sim = runCreSweep(parseJson(readFileSync("cre/sweep-config.json", "utf8")));
    expect(sim.workflowName).toBe("lockgate-sweep-local");
    expect(sim.handler).toBe("runCreSweep");
    expect(sim.mode).toBe("simulate");
    expect(sim.broadcast).toBe(false);
    expect(sim.onReportCalled).toBe(false);
    expect(sim.txHash).toBeNull();
    expect(sim.forwarder).toEqual({ contract: null, chainName: null, address: null });
    expect(sim.actions.map((item) => item.kind)).toEqual(["repay"]);
    expect(sim.actions[0]?.sendable).toBe(true);
    expect(sim.actions[0]?.calldata?.startsWith("0x371fd8e6")).toBe(true);
    expect(sim.report.counts.repay).toBe(1);
    expect(sim.report.sendable).toBe(1);
    const yaml = readFileSync("cre/sweep-workflow.yaml", "utf8");
    expect(yaml).toContain('schedule: "0 */10 * * * *"');
    expect(yaml).toContain("broadcast: false");
    expect(sim.schedule).toBe("0 */10 * * * *");
  });

  it("records the directory mock forwarder on each allowlisted testnet", () => {
    const arbitrum = runCreSweep(book(421614));
    expect(arbitrum.forwarder).toEqual({
      contract: "MockKeystoneForwarder",
      chainName: "ethereum-testnet-sepolia-arbitrum-1",
      address: MOCK_ARBITRUM,
    });
    expect(arbitrum.forwarder.address).not.toBe(KEYSTONE_ARBITRUM);
    const ethereum = runCreSweep(book(11_155_111));
    expect(ethereum.forwarder.address).toBe(MOCK_ETHEREUM);
    expect(ethereum.forwarder.chainName).toBe("ethereum-testnet-sepolia");
    expect(ethereum.forwarder.address).not.toBe(KEYSTONE_ETHEREUM);
    expect(arbitrum.onReportCalled).toBe(false);
    expect(ethereum.txHash).toBeNull();
  });

  it("keeps a partner repay in the plan and does not mark it sendable", () => {
    const sim = runCreSweep(book(421614, { vaultKind: "partner" }));
    expect(sim.actions[0]?.kind).toBe("repay");
    expect(sim.actions[0]?.sendable).toBe(false);
    expect(sim.actions[0]?.reason).toBe("partner vault: Lockgate will not send repay");
    expect(sim.report.sendable).toBe(0);
    expect(sim.onReportCalled).toBe(false);
  });

  it("accepts a 30-second cron and a timezone prefix, and rejects a faster one", () => {
    expect(runCreSweep(book(31337, {}, "*/30 * * * * *")).schedule).toBe("*/30 * * * * *");
    expect(runCreSweep(book(31337, {}, "TZ=Asia/Singapore 0 */10 * * * *")).scheduledExecutionTime).toBe(now);
    const fired = runCreSweep({ ...book(31337), scheduledExecutionTime: now + 30 });
    expect(fired.scheduledExecutionTime).toBe(now + 30);
    expect(fired.report.now).toBe(now);
    expect(() => runCreSweep(book(31337, {}, "*/10 * * * * *"))).toThrow(EngineError);
    expect(() => runCreSweep(book(31337, {}, "* * * * * *"))).toThrow(/30 seconds/);
    expect(() => runCreSweep(book(31337, {}, "0 0 * *"))).toThrow(/5 or 6 fields/);
  });

  it("refuses mainnet and stays offline", () => {
    expect(() => runCreSweep(book(1))).toThrow(EngineError);
    expect(() => runCreSweep(book(42161))).toThrow(/chain 42161/);
    const forbidden = creSweepEntry(book(42161));
    expect(isApiError(forbidden)).toBe(true);
    if (isApiError(forbidden)) expect(forbidden.code).toBe("mainnet-forbidden");
    const fast = creSweepEntry(book(31337, {}, "*/10 * * * * *"));
    if (isApiError(fast)) expect(fast.code).toBe("param");
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("network");
    }) as typeof fetch;
    try {
      const sim = runCreSweep(parseJson(readFileSync("fixtures/sepolia/cre-sweep.json", "utf8")));
      expect(sim.chainId).toBe(421614);
      expect(sim.forwarder.address).toBe(MOCK_ARBITRUM);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
