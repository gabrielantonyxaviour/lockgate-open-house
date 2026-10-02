import { scenarioSchema, type Scenario } from "./schema.js";

/** Seeds shared by the 360-day book and the long-horizon run. */
export const REFERENCE_SEEDS = [
  20261001, 20261002, 20261003, 20261004, 20261005, 20261006, 20261007, 20261008, 20261009, 20261010,
] as const;

/** Three reference-book years. Placement assumption, not a cited tenor. */
export const HORIZON_DAYS = 1_080;
export const GATE_BLOCK_DAYS = 360;
export const QUARTERLY_GATE_DAYS = 90;
export const EPOCH_GATE_START = 40;
export const EPOCH_GATE_END = 70;

/**
 * Depeg factor 0.92, bank-run multiplier 12, and coverage 0.5 match the
 * single-shock rows. The dates and defaultCount 2 are placement assumptions.
 */
export const MIXED = {
  depegStart: 360,
  depegEnd: 420,
  depegFactor: 0.92,
  runStart: 720,
  runEnd: 750,
  runMultiplier: 12,
  runCoverage: 0.5,
  defaultCount: 2,
} as const;

/** Shock definitions. Every number here is a scenario assumption, validated by zod. */
export function scenarioSet(horizonDays: number): Scenario[] {
  const base = {
    horizonDays,
    mildShortfall: true,
    depegStart: 1,
    depegEnd: 0,
    depegFactor: 1,
    runStart: 0,
    runEnd: 0,
    runMultiplier: 1,
    runCoverage: 1,
    defaultCount: 0,
    gateMode: "none" as const,
    bankRunGates: false,
  };
  return [
    { ...base, name: "baseline" },
    { ...base, name: "gating", gateMode: "scheduled" },
    { ...base, name: "default", defaultCount: 4 },
    { ...base, name: "depeg", depegStart: 120, depegEnd: 150, depegFactor: 0.92 },
    {
      ...base,
      name: "bank-run",
      runStart: 90,
      runEnd: 110,
      runMultiplier: 12,
      runCoverage: 0.5,
      bankRunGates: true,
      mildShortfall: false,
    },
  ].map((row) => scenarioSchema.parse(row));
}

/** One path. Gates repeat every 360 days. Depeg and the bank-run each fire once. */
export function mixedHorizon(horizonDays: number = HORIZON_DAYS): Scenario {
  return scenarioSchema.parse({
    name: "mixed",
    horizonDays,
    mildShortfall: true,
    depegStart: MIXED.depegStart,
    depegEnd: MIXED.depegEnd,
    depegFactor: MIXED.depegFactor,
    runStart: MIXED.runStart,
    runEnd: MIXED.runEnd,
    runMultiplier: MIXED.runMultiplier,
    runCoverage: MIXED.runCoverage,
    defaultCount: MIXED.defaultCount,
    gateMode: "none",
    bankRunGates: true,
  });
}

/** Day number inside the current 360-day block, from 1. */
export function yearDay(day: number): number {
  if (day <= 0) return 0;
  return ((day - 1) % GATE_BLOCK_DAYS) + 1;
}

/** Scheduled gate, repeated each 360-day block. Weekly platforms are not gated here. */
export function mixedKindGated(kind: "weekly" | "epoch" | "quarterly", day: number): boolean {
  const today = yearDay(day);
  if (kind === "quarterly") return today <= QUARTERLY_GATE_DAYS;
  if (kind === "epoch") return today >= EPOCH_GATE_START && today <= EPOCH_GATE_END;
  return false;
}
