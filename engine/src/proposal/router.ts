import type { Address } from "../domain.js";
import type { Mandate } from "../domain.js";

export type RoutePolicy = "lowest-fee" | "most-capacity" | "round-robin";

export type VaultCandidate = {
  mandate: Mandate;
  idle: bigint;
  cursor: number;
};

export type RouteChoice = {
  vault: Address;
  index: number;
  eligible: VaultCandidate[];
};

export function eligibleVaults(
  candidates: VaultCandidate[],
  maxFeeBps: number,
  now: number,
  platform: Address,
  navValue: bigint,
): VaultCandidate[] {
  return candidates.filter((candidate) => {
    const mandate = candidate.mandate;
    if (mandate.expiresAt <= now) return false;
    if (mandate.minFeeBps > maxFeeBps) return false;
    if (candidate.idle < navValue) return false;
    return mandate.approvedPlatforms.some((item) => item.toLowerCase() === platform.toLowerCase());
  });
}

export function routeVaults(
  candidates: VaultCandidate[],
  policy: RoutePolicy,
  maxFeeBps: number,
  now: number,
  platform: Address,
  navValue: bigint,
  roundRobin: number,
): RouteChoice | null {
  const eligible = eligibleVaults(candidates, maxFeeBps, now, platform, navValue);
  if (eligible.length === 0) return null;
  if (policy === "most-capacity") {
    const ranked = [...eligible].sort((a, b) => (a.idle === b.idle ? a.cursor - b.cursor : a.idle > b.idle ? -1 : 1));
    return { vault: ranked[0]!.mandate.vault, index: candidates.indexOf(ranked[0]!), eligible };
  }
  if (policy === "round-robin") {
    const ordered = [...eligible].sort((a, b) => a.cursor - b.cursor);
    const pick = ordered[roundRobin % ordered.length]!;
    return { vault: pick.mandate.vault, index: candidates.indexOf(pick), eligible };
  }
  const ranked = [...eligible].sort((a, b) => a.mandate.minFeeBps - b.mandate.minFeeBps || a.cursor - b.cursor);
  return { vault: ranked[0]!.mandate.vault, index: candidates.indexOf(ranked[0]!), eligible };
}
