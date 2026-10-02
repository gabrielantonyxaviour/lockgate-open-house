import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeFunctionData, hashTypedData } from "viem";
import { replayRecordedQueue } from "../src/backtest/replay.js";
import { EngineError } from "../src/errors.js";
import { encodeJson, parseJson } from "../src/json.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { buildProposal } from "../src/proposal/build.js";
import { submitProposalAbi } from "../src/proposal/partner.js";
import { advanceTypes } from "../src/proposal/typed.js";

const scenario = new URL("../fixtures/regression/queue-scenario.json", import.meta.url);
const golden = new URL("../fixtures/regression/queue-proposals.json", import.meta.url);
const NAV = 10_000_000_000n;

type Tick = {
  outcome: string;
  input: { platformId: string; kind: string; utilizationBps: number; repayment: { slashed: number } };
};

type Row = { digest: string; calldata: string; feeBps: number; fee: string };

const tapeShape = [
  ["repay", "northwind-invoice", "quarterly-gated", 0],
  ["repay", "northwind-invoice", "epoch", 0],
  ["slash", "northwind-invoice", "epoch", 0],
  ["repay", "northwind-invoice", "epoch", 0],
  ["repay", "northwind-invoice", "epoch", 9000],
  ["repay", "northwind-invoice", "weekly-cycle", 0],
  ["repay", "northwind-invoice", "fifo-open", 0],
  ["repay", "harbor-epoch-credit", "epoch", 0],
] as const;

describe("backtest regression", () => {
  it("locks proposal bytes and a fee that moves after a slash", () => {
    const raw = parseJson(readFileSync(scenario, "utf8")) as { ticks: Tick[] };
    expect(raw.ticks.map((tick) => [tick.outcome, tick.input.platformId, tick.input.kind, tick.input.utilizationBps])).toEqual(
      tapeShape.map((row) => [...row]),
    );
    expect(raw.ticks.every((tick) => tick.input.repayment.slashed === 0)).toBe(true);
    const first = encodeJson(replayRecordedQueue(raw));
    const second = encodeJson(replayRecordedQueue(raw));
    expect(second).toBe(first);
    expect(`${first}\n`).toBe(readFileSync(golden, "utf8"));
    const rows = JSON.parse(first) as Row[];
    const [quarter, clean, slash, afterSlash, busy, weekly, fifo, other] = rows;
    expect(rows).toHaveLength(tapeShape.length);
    expect(clean?.feeBps).toBe(101);
    expect(slash?.feeBps).toBe(clean?.feeBps);
    expect(other?.feeBps).toBe(clean?.feeBps);
    expect(afterSlash!.feeBps).toBeGreaterThan(clean!.feeBps);
    expect(busy!.feeBps).toBeGreaterThan(afterSlash!.feeBps);
    expect(quarter!.feeBps).toBeGreaterThan(busy!.feeBps);
    expect(weekly?.feeBps).toBe(25);
    expect(fifo?.feeBps).toBe(25);
    expect(new Set(rows.map((row) => row.feeBps)).size).toBeGreaterThan(1);
    expect(new Set(rows.map((row) => row.digest)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.calldata)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.digest).toMatch(/^0x[0-9a-f]{64}$/);
      expect(row.calldata.startsWith("0xe7c1fee8")).toBe(true);
      expect(BigInt(row.fee)).toBe((NAV * BigInt(row.feeBps) + 9_999n) / 10_000n);
    }
  });

  it("keeps the recorded tape when the filing is hashed once", () => {
    const raw = parseJson(readFileSync(scenario, "utf8")) as {
      chainId: number;
      platform: string;
      recipient: string;
      mandate: unknown;
      ticks: { nonce: string; input: unknown }[];
    };
    const rows = replayRecordedQueue(raw);
    expect(`${encodeJson(rows)}\n`).toBe(readFileSync(golden, "utf8"));
    const first = raw.ticks[0];
    if (!first) throw new Error("recorded tape is empty");
    const built = buildProposal({
      input: first.input,
      params: DEFAULT_PARAMS,
      mandate: raw.mandate,
      platform: raw.platform,
      recipient: raw.recipient,
      chainId: raw.chainId,
      nonce: BigInt(first.nonce),
    });
    expect(built.digest).toBe(rows[0]?.digest);
    expect(built.calldata).toBe(rows[0]?.calldata);
    expect(hashTypedData({
      domain: built.domain,
      types: advanceTypes,
      primaryType: "AdvanceProposal",
      message: built.message,
    })).toBe(built.digest);
    expect(encodeFunctionData({
      abi: submitProposalAbi,
      functionName: "submitProposal",
      args: [built.message, "0x"],
    })).toBe(built.calldata);
  });

  it("refuses a gated tick and returns no proposal bytes", () => {
    const raw = parseJson(readFileSync(scenario, "utf8")) as { ticks: { input: { gated: boolean } }[] };
    raw.ticks[3]!.input.gated = true;
    expect(() => replayRecordedQueue(raw)).toThrow(EngineError);
    try {
      replayRecordedQueue(raw);
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe("refused");
      expect((err as EngineError).message).toBe("gated");
    }
  });
});
