import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeJson, parseJson } from "../src/json.js";
import { planSweep } from "../src/sweep/sweep.js";

const bookUrl = new URL("../fixtures/regression/sweep-book.json", import.meta.url);
const golden = new URL("../fixtures/regression/sweep-plan.json", import.meta.url);

type Advance = { id: string; dueAt: number; cash: string | null; navValue: string; vaultKind: string };
type Book = { now: number; graceSeconds: number; advances: Advance[] };
type Action = { kind: string; sendable: boolean; calldata: string | null; vaultKind: string };

const kinds = [
  "pending",
  "repay",
  "repay",
  "mark-late",
  "mark-late",
  "wait-for-cash",
  "wait-for-cash",
  "skip",
  "skip",
  "repay",
  "mark-late",
] as const;

describe("sweep regression", () => {
  it("locks repay and markLate bytes at the grace and cash boundaries", () => {
    const book = parseJson(readFileSync(bookUrl, "utf8")) as Book;
    const now = book.now;
    const grace = book.graceSeconds;
    expect(book.advances[1]).toMatchObject({ dueAt: now, cash: book.advances[1]!.navValue, vaultKind: "own-book" });
    expect(book.advances[2]?.dueAt).toBe(now - grace + 1);
    expect(book.advances[3]?.dueAt).toBe(now - grace);
    expect(book.advances[5]?.cash).toBe("9999999999");
    expect(book.advances[6]?.cash).toBeNull();
    expect(book.advances[9]?.vaultKind).toBe("partner");
    expect(book.advances[10]?.vaultKind).toBe("partner");
    const first = encodeJson(planSweep(book));
    const second = encodeJson(planSweep(book));
    expect(second).toBe(first);
    expect(`${first}\n`).toBe(readFileSync(golden, "utf8"));
    const rows = JSON.parse(first) as Action[];
    expect(rows.map((row) => row.kind)).toEqual([...kinds]);
    const repay = rows.find((row) => row.kind === "repay" && row.sendable)?.calldata ?? "";
    const late = rows.find((row) => row.kind === "mark-late" && row.sendable)?.calldata ?? "";
    expect(repay.slice(0, 10)).toBe("0x371fd8e6");
    expect(late.slice(0, 10)).toBe("0x184f24db");
    for (const row of rows) {
      if (row.kind === "repay" || row.kind === "wait-for-cash") expect(row.calldata?.startsWith("0x371fd8e6")).toBe(true);
      if (row.kind === "mark-late") expect(row.calldata?.startsWith("0x184f24db")).toBe(true);
      if (row.kind === "pending" || row.kind === "skip") expect(row.calldata).toBeNull();
      if (row.vaultKind === "partner") expect(row.sendable).toBe(false);
    }
    expect(rows.filter((row) => row.sendable).map((row) => row.kind)).toEqual(["repay", "repay", "mark-late", "mark-late"]);
  });
});
