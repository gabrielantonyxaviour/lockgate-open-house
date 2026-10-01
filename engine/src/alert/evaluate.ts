import type { Quote } from "../quote.js";
import type { QuoteInput } from "../domain.js";
import type { PricingParams } from "../domain.js";
import type { SweepAction } from "../sweep/sweep.js";

export type Alert = {
  severity: "info" | "warn" | "critical";
  code: string;
  platformId: string;
  message: string;
  evidence: Record<string, string | number | boolean>;
};

export function alertsForQuote(input: QuoteInput, quote: Quote, params: PricingParams): Alert[] {
  const alerts: Alert[] = [];
  const push = (severity: Alert["severity"], code: string, message: string, evidence: Alert["evidence"] = {}) => {
    alerts.push({ severity, code, platformId: input.platformId, message, evidence });
  };
  for (const item of quote.blocks) {
    const critical = ["reserve", "stale-nav", "gated", "illiquid", "concentration", "limit", "peg", "stale-oracle"].includes(item.code);
    push(critical ? "critical" : "warn", item.code, item.reason);
  }
  if (quote.available && input.utilizationBps >= 9_000) {
    push("critical", "utilization", "book utilization is at or above 90%", { utilizationBps: input.utilizationBps });
  } else if (quote.available && input.utilizationBps >= params.kinkUtilBps) {
    push("warn", "utilization", "book utilization is at or above the kink", { utilizationBps: input.utilizationBps });
  }
  if (quote.assumption) push("warn", "assumption", quote.assumption, { assumption: quote.assumption });
  if (input.reserveBps < 750) {
    push("info", "reserve-policy", "posted reserve is inside 5–10% but below the 7.5% demo seed", { reserveBps: input.reserveBps });
  }
  return alerts;
}

export function alertsForSweep(platformId: string, actions: SweepAction[]): Alert[] {
  return actions.flatMap((action): Alert[] => {
    if (action.kind === "mark-late") {
      return [{
        severity: "critical" as const,
        code: "late",
        platformId,
        message: action.reason,
        evidence: { advanceId: action.advanceId.toString(), vaultKind: action.vaultKind },
      }];
    }
    if (action.kind === "wait-for-cash") {
      return [{
        severity: "warn" as const,
        code: "cash-short",
        platformId,
        message: action.reason,
        evidence: { advanceId: action.advanceId.toString() },
      }];
    }
    if (action.kind === "repay" && action.vaultKind === "partner") {
      return [{
        severity: "info" as const,
        code: "partner-repay",
        platformId,
        message: "repay calldata is ready for the partner keeper",
        evidence: { advanceId: action.advanceId.toString() },
      }];
    }
    return [];
  });
}
