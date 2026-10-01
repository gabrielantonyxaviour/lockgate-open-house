import { DEFAULT_PARAMS } from "./pricing/defaults.js";
import type { PricingParams, QuoteInput, RepaymentHistory } from "./domain.js";

const U = 1_000_000n;
export const DAY = 86_400;

export function seasonedHistory(): RepaymentHistory {
  return { samples: 8, onTime: 8, late: 0, slashed: 0, gateEvents: 0, windowsObserved: 8 };
}

export function emptyHistory(): RepaymentHistory {
  return { samples: 0, onTime: 0, late: 0, slashed: 0, gateEvents: 0, windowsObserved: 0 };
}

function book(now: number, kind: QuoteInput["kind"], platformId: string): QuoteInput {
  return {
    platformId,
    kind,
    now,
    navValue: 10_000n * U,
    queuedAhead: 0n,
    cashAvailable: 50_000n * U,
    cashPerEpoch: 50_000n * U,
    cashKnown: true,
    gated: false,
    navUpdatedAt: now - 3_600,
    reserveBalance: 750n * U,
    reserveBps: 750,
    exposure: 0n,
    limit: 25_000n * U,
    bookAssets: 100_000n * U,
    utilizationBps: 0,
    repayment: seasonedHistory(),
    requestId: 11n,
  };
}

/** Thirty real days, the "about 1% a month" case. USD.AI-style epoch. */
export function monthEpoch(now = 1_700_000_000): QuoteInput {
  return {
    ...book(now, "epoch", "harbor-epoch-credit"),
    epochStart: now,
    epochSeconds: 30 * DAY,
    cutoffSeconds: DAY,
    requestedAt: now,
  };
}

/** Kasu-style week. Request lands two days into a seven-day epoch, before the 48h clearing. */
export function weeklyClear(now = 1_700_000_000): QuoteInput {
  return {
    ...book(now, "weekly-cycle", "northwind-invoice"),
    epochStart: now - 2 * DAY,
    requestedAt: now,
  };
}

export function quarterlyOpen(now = 1_700_000_000): QuoteInput {
  return {
    ...book(now, "quarterly-gated", "lumen-quarterly"),
    epochStart: now,
    windowSeconds: 90 * DAY,
    requestedAt: now,
    reserveBalance: 750n * U,
  };
}

export function mapleCovered(now = 1_700_000_000): QuoteInput {
  return {
    ...book(now, "fifo-open", "maple-syrup-usdc"),
    cashKnown: true,
    cashAvailable: 80_000n * U,
    requestedAt: now,
  };
}

export function demoTenMinutes(now = 1_700_000_000): { input: QuoteInput; params: PricingParams } {
  return {
    input: {
      ...book(now, "weekly-cycle", "demo-sandbox"),
      epochStart: now,
      epochSeconds: 600,
      clearingSeconds: 60,
      requestedAt: now,
    },
    params: { ...DEFAULT_PARAMS, timeScale: 4320 },
  };
}

export function exampleBundle(name: string): { input: QuoteInput; params: PricingParams } {
  const params = { ...DEFAULT_PARAMS };
  switch (name) {
    case "weekly":
      return { input: weeklyClear(), params };
    case "epoch":
      return { input: monthEpoch(), params };
    case "quarterly":
      return { input: quarterlyOpen(), params };
    case "fifo":
      return { input: mapleCovered(), params };
    case "demo":
      return demoTenMinutes();
    default:
      throw new Error(`unknown example ${name}`);
  }
}
