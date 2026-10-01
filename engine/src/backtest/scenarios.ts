import { monthEpoch, quarterlyOpen, weeklyClear } from "../examples.js";
import type { BacktestTick } from "./harness.js";

const U = 1_000_000n;

export function kasuRepayThenSlash(): BacktestTick[] {
  const first = weeklyClear();
  const epochStart = first.epochStart ?? first.now;
  const second = {
    ...first,
    now: first.now + 7 * 86_400,
    epochStart: epochStart + 7 * 86_400,
    requestedAt: first.now + 7 * 86_400,
    navUpdatedAt: first.now + 7 * 86_400 - 60,
    requestId: 12n,
  };
  return [
    { input: first, outcome: "repay" },
    { input: second, outcome: "slash" },
  ];
}

export function epochRepay(): BacktestTick[] {
  return [{ input: monthEpoch(), outcome: "repay" }];
}

export function gatedRefuse(): BacktestTick[] {
  return [{ input: { ...quarterlyOpen(), gated: true }, outcome: "refuse" }];
}

export function staleRefuse(): BacktestTick[] {
  const input = monthEpoch();
  return [{ input: { ...input, navUpdatedAt: input.now - 8 * 86_400 }, outcome: "refuse" }];
}

export function busyBook(): BacktestTick[] {
  return [{ input: { ...monthEpoch(), utilizationBps: 6_667, platformId: "harbor-busy" }, outcome: "repay" }];
}

export function reserveShort(): BacktestTick[] {
  const input = monthEpoch();
  return [{ input: { ...input, reserveBalance: 750n * U - 1n }, outcome: "refuse" }];
}

export const SCENARIOS = {
  "kasu-repay-slash": kasuRepayThenSlash,
  "epoch-repay": epochRepay,
  "gated-refuse": gatedRefuse,
  "stale-refuse": staleRefuse,
  "busy-book": busyBook,
  "reserve-short": reserveShort,
} as const;
