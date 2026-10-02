import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PricingParams } from "../domain.js";
import { EngineError } from "../errors.js";
import { encodeJson } from "../json.js";
import { assertProvenance, recordedScenarios, type DataOrigin, type RecordedScenario } from "./catalog.js";
import { runBacktest } from "./harness.js";

export type BacktestTickRow = {
  index: number;
  platformId: string;
  kind: string;
  outcome: string;
  available: boolean;
  feeBps: number;
  fee: string;
  payout: string;
  matchedExpectation: boolean;
  origin: DataOrigin;
  source: string | null;
};

export type BacktestScenarioReport = {
  name: string;
  origin: DataOrigin;
  source: string | null;
  note: string;
  advanced: number;
  refused: number;
  mismatches: number;
  feeEarned: string;
  loss: string;
  reserveUsed: string;
  ticks: BacktestTickRow[];
};

export type BacktestBundle = {
  kind: "backtest-report";
  parameters: {
    origin: "synthetic";
    source: null;
    note: string;
    value: PricingParams;
  };
  scenarios: BacktestScenarioReport[];
};

const PARAM_NOTE = "Product decisions passed into the pricer. Not a fitted market tape.";

export function buildBacktestBundle(records: RecordedScenario[], params: PricingParams): BacktestBundle {
  if (records.length === 0) throw new EngineError("param", "backtest report needs a scenario");
  return {
    kind: "backtest-report",
    parameters: { origin: "synthetic", source: null, note: PARAM_NOTE, value: params },
    scenarios: records.map((record) => scenarioReport(record, params)),
  };
}

export function recordedBacktestBundle(params: PricingParams): BacktestBundle {
  return buildBacktestBundle(recordedScenarios(), params);
}

function scenarioReport(record: RecordedScenario, params: PricingParams): BacktestScenarioReport {
  const provenance = assertProvenance(record.name, record.provenance);
  const report = runBacktest(record.ticks, params);
  const source = provenance.source ?? null;
  return {
    name: record.name,
    origin: provenance.origin,
    source,
    note: provenance.note,
    advanced: report.advanced,
    refused: report.refused,
    mismatches: report.mismatches,
    feeEarned: report.feeEarned.toString(),
    loss: report.loss.toString(),
    reserveUsed: report.reserveUsed.toString(),
    ticks: report.ticks.map((tick, index) => ({
      index,
      platformId: tick.platformId,
      kind: record.ticks[index]?.input.kind ?? "",
      outcome: tick.outcome,
      available: tick.quote.available,
      feeBps: tick.quote.feeBps,
      fee: tick.quote.fee.toString(),
      payout: tick.quote.payout.toString(),
      matchedExpectation: tick.matchedExpectation,
      origin: provenance.origin,
      source,
    })),
  };
}

function cell(value: string | number | boolean | null): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

/** One markdown document. Amounts are decimal strings. Origin is on every row. */
export function renderBacktestMarkdown(bundle: BacktestBundle): string {
  const lines = [
    "# Backtest report",
    "",
    "Each scenario and each tick is `sourced` or `synthetic`. A sourced row names an http(s) URL. The parameter set is a product decision, not a fitted market tape.",
    "",
    `Parameters: synthetic. ${bundle.parameters.note}`,
    "",
    "| Scenario | Origin | Source | Advanced | Refused | Fee earned | Loss | Mismatches |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const scenario of bundle.scenarios) {
    lines.push(`| ${cell(scenario.name)} | ${scenario.origin} | ${cell(scenario.source)} | ${scenario.advanced} | ${scenario.refused} | ${scenario.feeEarned} | ${scenario.loss} | ${scenario.mismatches} |`);
  }
  for (const scenario of bundle.scenarios) {
    lines.push(
      "",
      `## ${scenario.name}`,
      "",
      `${scenario.origin}. ${scenario.note}`,
      scenario.source ? `Source: ${scenario.source}` : "Source: none.",
      "",
      "| Tick | Platform | Kind | Outcome | Available | Fee bps | Fee | Payout | Origin |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const tick of scenario.ticks) {
      lines.push(`| ${tick.index} | ${cell(tick.platformId)} | ${cell(tick.kind)} | ${tick.outcome} | ${tick.available} | ${tick.feeBps} | ${tick.fee} | ${tick.payout} | ${tick.origin} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function renderBacktestJson(bundle: BacktestBundle): string {
  return encodeJson(bundle);
}

/** Write `backtest-report.json` and `backtest-report.md` under `dir`. */
export function writeBacktestReport(dir: string, bundle: BacktestBundle): { json: string; markdown: string } {
  const json = join(dir, "backtest-report.json");
  const markdown = join(dir, "backtest-report.md");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(json, `${renderBacktestJson(bundle)}\n`);
    writeFileSync(markdown, renderBacktestMarkdown(bundle));
  } catch {
    throw new EngineError("internal", "could not write the backtest report");
  }
  return { json, markdown };
}
