import { z } from "zod";

export const scenarioSchema = z.object({
  name: z.enum([
    "baseline", "gating", "default", "depeg", "bank-run", "mixed", "usdc-depeg", "stale-price", "tri-gate",
  ]),
  horizonDays: z.number().int().min(30).max(1_500),
  mildShortfall: z.boolean(),
  depegStart: z.number().int().min(0),
  depegEnd: z.number().int().min(0),
  depegFactor: z.number().min(0).max(1),
  /** Off leaves draws and window cash on the existing path. */
  oracle: z.enum(["off", "usdc-depeg", "stale-price"]).default("off"),
  oracleStart: z.number().int().min(0).default(0),
  oracleEnd: z.number().int().min(0).default(0),
  runStart: z.number().int().min(0),
  runEnd: z.number().int().min(0),
  runMultiplier: z.number().positive().max(100),
  runCoverage: z.number().min(0).max(1),
  defaultCount: z.number().int().min(0).max(36),
  gateMode: z.enum(["none", "scheduled"]),
  bankRunGates: z.boolean(),
  /** Named platforms gated together. Empty on every scenarioSet row. */
  gateIds: z.array(z.string()).max(36).default(() => []),
  gateStart: z.number().int().min(0).default(0),
  gateEnd: z.number().int().min(0).default(0),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export const stageSchema = z.enum(["stage1", "stage2", "stage3"]);
export type Stage = z.infer<typeof stageSchema>;

export const runRequestSchema = z.object({
  seeds: z.array(z.number().int().positive()).min(1).max(50),
  horizonDays: z.number().int().min(30).max(1_500).default(360),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export function parseScenario(input: unknown): Scenario {
  return scenarioSchema.parse(input);
}
