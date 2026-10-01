import { HarnessError } from "./errors.js";

const SCALE = 1_000_000n;

export function parseUsdg(input: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(input)) {
    throw new HarnessError("USDG amount must be a positive decimal with at most 6 places", "VALIDATION");
  }
  const [whole, frac = ""] = input.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
}

export function formatUsdg(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

export function parseBps(input: string): number {
  if (!/^\d+$/.test(input)) throw new HarnessError("bps must be an integer", "VALIDATION");
  const value = Number(input);
  if (value > 10_000) throw new HarnessError("bps cannot exceed 10000", "VALIDATION");
  return value;
}

export function usdg(whole: bigint): bigint {
  return whole * SCALE;
}
