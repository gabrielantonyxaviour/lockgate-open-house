import type { Peg } from "../domain.js";

export type PegCode = "stale-oracle" | "peg";

/** Matches PartnerVaultRead and FacilityStore: a disabled oracle is not a depeg. */
export function pegFailure(now: number, peg: Peg | undefined): PegCode | null {
  if (!peg || !peg.enabled) return null;
  const stale = peg.updatedAt > now
    || peg.maxOracleAge === 0
    || now - peg.updatedAt > peg.maxOracleAge;
  if (stale) return "stale-oracle";
  if (peg.priceE8 < peg.minPriceE8) return "peg";
  return null;
}
