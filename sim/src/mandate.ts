import type { Line } from "./books.js";
import { fail } from "./errors.js";
import { MAX_FEE_BPS } from "./params.js";
import type { Stage } from "./schema.js";

export type Mandate = {
  platforms: ReadonlySet<string>;
  /** Owed-nav cap for one platform, micro-USDG. */
  limit: number;
  minFeeBps: number;
  maxTenorSeconds: number;
  /** Max platform share of vault assets, bps. */
  concentrationBps: number;
  expiryDay: number;
  paused: boolean;
};

export type MandateInput = {
  platform: string;
  day: number;
  feeBps: number;
  tenorSeconds: number;
  principal: number;
  /** Owed nav. Caps use this, not the cash that left the vault. */
  owed: number;
};

/** Idle cash plus outstanding principal. Posted reserve is not part of this base. */
export function mandateAssets(line: Line): number {
  return line.balance - line.reserve + line.principal;
}

export function mandateReject(line: Line, mandate: Mandate, input: MandateInput): string | null {
  if (mandate.paused) return "mandate-paused";
  if (input.day > mandate.expiryDay) return "mandate-expired";
  if (!mandate.platforms.has(input.platform)) return "mandate-platform";
  if (input.feeBps < mandate.minFeeBps || input.feeBps > MAX_FEE_BPS) return "mandate-fee";
  if (input.tenorSeconds > mandate.maxTenorSeconds) return "mandate-tenor";
  const nextExposure = (line.exposure[input.platform] ?? 0) + input.owed;
  if (input.owed > mandate.limit || nextExposure > mandate.limit) return "mandate-limit";
  const assets = mandateAssets(line);
  if (assets <= 0) return "mandate-empty";
  const cap = Math.floor((assets * mandate.concentrationBps) / 10_000);
  if (input.owed > cap || nextExposure > cap) return "mandate-concentration";
  return null;
}

export type VaultOffer = {
  index: number;
  feeBps: number;
  principal: number;
  idle: number;
};

/** Lowest fee that clears the mandate. Tie: more idle cash. */
export function pickBestFee(offers: readonly VaultOffer[]): VaultOffer | null {
  let best: VaultOffer | null = null;
  for (const offer of offers) {
    if (!best || offer.feeBps < best.feeBps || (offer.feeBps === best.feeBps && offer.idle > best.idle)) {
      best = offer;
    }
  }
  return best;
}

export type LimitPeaks = {
  platform: Record<string, number>;
  mandate: Record<string, number>;
  concentrationGap: Record<string, number>;
};

export function emptyPeaks(): LimitPeaks {
  return { platform: {}, mandate: {}, concentrationGap: {} };
}

/**
 * Booked owed nav stays inside the platform cap and, on stage 2, the vault mandate cap.
 * Concentration is checked again here only to record a gap after assets shrink.
 * A gap is not a new draw.
 */
export function scanLimits(
  stage: Stage,
  lines: readonly Line[],
  vaults: readonly { id: string; mandate: Mandate; line: Line }[],
  platforms: readonly { id: string; limit: number }[],
  peaks: LimitPeaks,
): void {
  const totals: Record<string, number> = {};
  for (const line of lines) {
    for (const [id, owed] of Object.entries(line.exposure)) {
      if (owed < 0) fail(`negative exposure on ${id}`, "mandate-limit");
      totals[id] = (totals[id] ?? 0) + owed;
    }
  }
  for (const platform of platforms) {
    const owed = totals[platform.id] ?? 0;
    if (owed > platform.limit) fail(`${platform.id} owed ${owed} over platform limit ${platform.limit}`, "over-limit");
    if (owed > (peaks.platform[platform.id] ?? 0)) peaks.platform[platform.id] = owed;
  }
  if (stage !== "stage2") return;
  for (const vault of vaults) {
    for (const [id, owed] of Object.entries(vault.line.exposure)) {
      if (owed > vault.mandate.limit) {
        fail(`${vault.id} owed ${owed} to ${id} over mandate limit ${vault.mandate.limit}`, "mandate-limit");
      }
      const key = `${vault.id}:${id}`;
      if (owed > (peaks.mandate[key] ?? 0)) peaks.mandate[key] = owed;
      const assets = mandateAssets(vault.line);
      const cap = assets <= 0 ? 0 : Math.floor((assets * vault.mandate.concentrationBps) / 10_000);
      if (owed > cap) {
        const gap = owed - cap;
        if (gap > (peaks.concentrationGap[key] ?? 0)) peaks.concentrationGap[key] = gap;
      }
    }
  }
}

export function pickRoundRobin(offers: readonly VaultOffer[], cursor: number): { offer: VaultOffer; cursor: number } | null {
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => a.index - b.index);
  const choice = sorted[cursor % sorted.length]!;
  return { offer: choice, cursor: cursor + 1 };
}

/** Weight by idle cash. `ticket` is in [0, totalIdle). */
export function pickProRata(offers: readonly VaultOffer[], ticket: number): VaultOffer | null {
  let total = 0;
  for (const offer of offers) total += Math.max(offer.idle, 0);
  if (total <= 0 || offers.length === 0) return offers[0] ?? null;
  let left = ticket % total;
  for (const offer of offers) {
    left -= Math.max(offer.idle, 0);
    if (left < 0) return offer;
  }
  return offers[offers.length - 1] ?? null;
}
