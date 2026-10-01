import type { Address } from "../domain.js";
import { EngineError } from "../errors.js";

/** Hard cap so a caller cannot turn a queue read into an unbounded RPC loop. */
export const MAX_QUEUE_SCAN = 256;

export function scanBound(requested: number | undefined): number {
  if (requested === undefined) return 100;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new EngineError("param", "maxScan must be a positive integer");
  }
  return Math.min(requested, MAX_QUEUE_SCAN);
}

export interface ContractReader {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export function named(value: unknown, key: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  throw new Error(`missing ${key}`);
}

export function asBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} is negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is not a safe integer`);
    return BigInt(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`${label} is not an integer`);
}

export function asAddress(value: unknown, label: string): Address {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)) return value as Address;
  throw new Error(`${label} is not an address`);
}
