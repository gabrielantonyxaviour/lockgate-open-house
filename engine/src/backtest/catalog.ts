import { EngineError } from "../errors.js";
import type { BacktestTick } from "./harness.js";
import { SCENARIOS } from "./scenarios.js";

export type DataOrigin = "sourced" | "synthetic";

export type Provenance = {
  origin: DataOrigin;
  source?: string;
  note: string;
};

export type RecordedScenario = {
  name: string;
  ticks: BacktestTick[];
  provenance: Provenance;
};

const NOTES: Record<keyof typeof SCENARIOS, string> = {
  "kasu-repay-slash": "Two constructed weekly ticks. The week shape is the engine example, not a Kasu export.",
  "epoch-repay": "Constructed 30-day epoch. Face, cash, and reserve are round test amounts.",
  "gated-refuse": "Constructed quarterly book with gated set true.",
  "stale-refuse": "Constructed epoch whose NAV stamp is eight days before now.",
  "busy-book": "Constructed epoch with utilization 9000 bps (above the 6667 kink).",
  "reserve-short": "Constructed epoch whose reserve is one unit under 750 USDG.",
};

/** The six CLI scenarios. Each book is constructed in this package. */
export function recordedScenarios(): RecordedScenario[] {
  return (Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((name) => ({
    name,
    ticks: SCENARIOS[name](),
    provenance: { origin: "synthetic", note: NOTES[name] },
  }));
}

const HTTP = /^https?:\/\//i;
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** A sourced row needs an http(s) URL. A synthetic row cannot carry one. */
export function assertProvenance(name: string, provenance: Provenance): Provenance {
  if (!NAME.test(name)) throw new EngineError("param", "backtest scenario name is not a slug");
  if (!provenance.note.trim()) throw new EngineError("param", `${name}: provenance needs a note`);
  if (provenance.origin === "sourced") {
    if (!provenance.source || !HTTP.test(provenance.source)) {
      throw new EngineError("param", `${name}: a sourced scenario needs an http(s) source URL`);
    }
    return provenance;
  }
  if (provenance.origin !== "synthetic") {
    throw new EngineError("param", `${name}: provenance origin must be sourced or synthetic`);
  }
  if (provenance.source) {
    throw new EngineError("param", `${name}: a synthetic scenario cannot carry a source URL`);
  }
  return { origin: "synthetic", note: provenance.note };
}
