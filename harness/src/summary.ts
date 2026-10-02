import { HarnessError } from "./errors.js";

export type Meter = { gas: bigint };
export type Timing = { elapsedMs: number; gasUsed: string };
export type Clock = () => number;

export function noteGas(meter: Meter, used: bigint): void {
  if (typeof used !== "bigint" || used < 0n) throw new HarnessError("gas is invalid", "VALIDATION");
  meter.gas += used;
}

/** Wall time for one action, plus the receipt gas that action already recorded. */
export async function runReported(
  ctx: { meter: Meter },
  run: () => Promise<unknown>,
  clock: Clock = Date.now,
): Promise<unknown> {
  ctx.meter.gas = 0n;
  const started = clock();
  const result = await run();
  return attachTiming(result, started, ctx.meter.gas, clock());
}

export function attachTiming(result: unknown, started: number, gas: bigint, now: number): unknown {
  const timing: Timing = { elapsedMs: elapsed(started, now), gasUsed: gasText(gas) };
  if (isRecord(result)) {
    if ("timing" in result) throw new HarnessError("timing is already set", "VALIDATION");
    return { ...result, timing };
  }
  return { result, timing };
}

function elapsed(started: number, now: number): number {
  if (!Number.isSafeInteger(started) || !Number.isSafeInteger(now) || now < started) {
    throw new HarnessError("timing input is invalid", "VALIDATION");
  }
  return now - started;
}

function gasText(gas: bigint): string {
  if (typeof gas !== "bigint" || gas < 0n) throw new HarnessError("gas is invalid", "VALIDATION");
  return gas.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
