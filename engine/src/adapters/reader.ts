import type { Address } from "../domain.js";

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
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`${label} is not an integer`);
}

export function asAddress(value: unknown, label: string): Address {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)) return value as Address;
  throw new Error(`${label} is not an address`);
}
