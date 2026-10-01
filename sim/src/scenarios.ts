import { scenarioSchema, type Scenario } from "./schema.js";

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
