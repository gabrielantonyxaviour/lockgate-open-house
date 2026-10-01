import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import { EngineError } from "../src/errors.js";
import { broadcastOwnBook, planSweep, type AdvanceView } from "../src/sweep/sweep.js";
import { alertsForSweep } from "../src/alert/evaluate.js";

const vault = getAddress("0x00000000000000000000000000000000000000c1");
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const now = 1_000_000;
const grace = 86_400;

function advance(patch: Partial<AdvanceView>): AdvanceView {
  return {
    id: 1n,
    vault,
    platform,
    navValue: 1_000n,
    dueAt: now - 1_000,
    status: "active",
    cash: 5_000n,
    vaultKind: "own-book",
    ...patch,
  };
}

describe("sweeper", () => {
  it("repays inside the grace window, marks late after it, and skips a short platform", () => {
    const actions = planSweep({
      chainId: 31337,
      now,
      graceSeconds: grace,
      advances: [
        advance({ id: 1n, dueAt: now + 10 }),
        advance({ id: 2n, dueAt: now - 1_000 }),
        advance({ id: 3n, dueAt: now - grace - 5 }),
        advance({ id: 4n, dueAt: now - 1_000, cash: 10n }),
        advance({ id: 5n, status: "repaid" }),
        advance({ id: 6n, vaultKind: "partner", dueAt: now - 1_000 }),
      ],
    });
    expect(actions.map((item) => item.kind)).toEqual([
      "pending", "repay", "mark-late", "wait-for-cash", "skip", "repay",
    ]);
    expect(actions[1]?.sendable).toBe(true);
    expect(actions[5]?.sendable).toBe(false);
    expect(actions[2]?.calldata?.startsWith("0x")).toBe(true);
  });

  it("refuses mainnet and never asks a sender to touch partner funds", async () => {
    expect(() => planSweep({ chainId: 42161, now, graceSeconds: grace, advances: [] })).toThrow(EngineError);
    const partner = planSweep({
      chainId: 31337,
      now,
      graceSeconds: grace,
      advances: [advance({ vaultKind: "partner" })],
    });
    const calls: Hex[] = [];
    const sent = await broadcastOwnBook(partner, 31337, vault, async (tx) => {
      calls.push(tx.data);
      return "0x11" as Hex;
    });
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
    const forced = { ...partner[0]!, sendable: true };
    await expect(broadcastOwnBook([forced], 31337, vault, async () => "0x11")).rejects.toBeInstanceOf(EngineError);
    expect(alertsForSweep("northwind", partner).some((alert) => alert.code === "partner-repay")).toBe(true);
  });
});
