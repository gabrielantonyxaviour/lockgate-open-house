import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { encodeFunctionData, getAddress } from "viem";
import { EngineError } from "../src/errors.js";
import { classifyAdvance, creditLineAbi, planSweep, type AdvanceView, type SweepAction } from "../src/sweep/sweep.js";

const line = getAddress("0x00000000000000000000000000000000000000c1");
const platform = getAddress("0x00000000000000000000000000000000000000b1");

function rank(kind: SweepAction["kind"]): number {
  if (kind === "skip") return -1;
  if (kind === "pending") return 0;
  if (kind === "mark-late") return 2;
  return 1;
}

function expectKind(advance: AdvanceView, now: number, grace: number, action: SweepAction): void {
  const partner = advance.vaultKind === "partner";
  if (advance.status !== "active") {
    expect(action.kind).toBe("skip");
  } else if (now < advance.dueAt) {
    expect(action.kind).toBe("pending");
  } else if (now >= advance.dueAt + grace) {
    expect(action.kind).toBe("mark-late");
  } else if (advance.cash === null || advance.cash < advance.navValue) {
    expect(action.kind).toBe("wait-for-cash");
  } else {
    expect(action.kind).toBe("repay");
  }
  const sendable = !partner && (action.kind === "repay" || action.kind === "mark-late");
  expect(action.sendable).toBe(sendable);
  if (action.kind === "pending" || action.kind === "skip") {
    expect(action.calldata).toBeNull();
    return;
  }
  const name = action.kind === "mark-late" ? "markLate" : "repay";
  const data = encodeFunctionData({ abi: creditLineAbi, functionName: name, args: [advance.id] });
  expect(action.calldata).toBe(data);
}

describe("sweep properties", () => {
  it("classifies every clock the same way and never sends a partner vault", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }),
      fc.integer({ min: 0, max: 10 * 86_400 }),
      fc.integer({ min: -86_400, max: 20 * 86_400 }),
      fc.bigInt({ min: 1n, max: 10n ** 18n }),
      fc.bigInt({ min: 0n, max: 10n ** 18n }),
      fc.constantFrom("active", "repaid", "late"),
      fc.constantFrom("own-book", "partner"),
      fc.boolean(),
      (dueAt, grace, offset, nav, cash, status, vaultKind, unknownCash) => {
        const now = dueAt + offset;
        const advance: AdvanceView = {
          id: nav,
          vault: line,
          platform,
          navValue: nav,
          dueAt,
          status,
          cash: unknownCash ? null : cash,
          vaultKind,
        };
        const action = classifyAdvance(advance, now, grace);
        expectKind(advance, now, grace, action);
        expect(action.sendable && vaultKind === "partner").toBe(false);
      },
    ), { numRuns: 200 });
  });

  it("does not move backwards as time passes", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }),
      fc.integer({ min: 0, max: 5 * 86_400 }),
      fc.integer({ min: 0, max: 10 * 86_400 }),
      fc.bigInt({ min: 1n, max: 10n ** 12n }),
      (dueAt, grace, step, nav) => {
        const advance: AdvanceView = {
          id: 7n,
          vault: line,
          platform,
          navValue: nav,
          dueAt,
          status: "active",
          cash: nav,
          vaultKind: "own-book",
        };
        const early = classifyAdvance(advance, dueAt - 10, grace);
        const later = classifyAdvance(advance, dueAt - 10 + step, grace);
        expect(rank(later.kind)).toBeGreaterThanOrEqual(rank(early.kind));
        const atGrace = classifyAdvance(advance, dueAt + grace, grace);
        expect(atGrace.kind).toBe("mark-late");
        const inside = classifyAdvance(advance, dueAt + grace - (grace === 0 ? 0 : 1), grace);
        if (grace === 0) expect(inside.kind).toBe("mark-late");
        else expect(inside.kind).toBe("repay");
      },
    ), { numRuns: 100 });
  });

  it("rejects a grace window that leaves the safe integer range", () => {
    const dueAt = Number.MAX_SAFE_INTEGER;
    expect(() => classifyAdvance({
      id: 1n,
      vault: line,
      platform,
      navValue: 1n,
      dueAt,
      status: "active",
      cash: 1n,
      vaultKind: "own-book",
    }, dueAt, 1)).toThrow(EngineError);
    const planned = planSweep({
      chainId: 31337,
      now: 1_700_000_000,
      graceSeconds: 0,
      advances: [{
        id: "3",
        vault: line,
        platform,
        navValue: "10",
        dueAt: 1_700_000_000,
        status: "active",
        cash: "10",
        vaultKind: "own-book",
      }],
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]?.kind).toBe("mark-late");
  });
});
