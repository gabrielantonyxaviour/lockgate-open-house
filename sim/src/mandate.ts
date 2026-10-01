import { MAX_FEE_BPS } from "./params.js";
import type { Line } from "./books.js";

export type Mandate = {
  platforms: ReadonlySet<string>;
  /** Principal cap for one platform, micro-USDG. */
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

export function mandateReject(line: Line, mandate: Mandate, input: MandateInput): string | null {
  if (mandate.paused) return "mandate-paused";
  if (input.day > mandate.expiryDay) return "mandate-expired";
  if (!mandate.platforms.has(input.platform)) return "mandate-platform";
  if (input.feeBps < mandate.minFeeBps || input.feeBps > MAX_FEE_BPS) return "mandate-fee";
  if (input.tenorSeconds > mandate.maxTenorSeconds) return "mandate-tenor";
  const nextExposure = (line.exposure[input.platform] ?? 0) + input.owed;
  if (input.owed > mandate.limit || nextExposure > mandate.limit) return "mandate-limit";
  const assets = line.balance + line.principal;
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
