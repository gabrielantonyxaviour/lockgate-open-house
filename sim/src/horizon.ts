import { median, pctFromBps, percentile, sum, usd } from "./format.js";
import { HORIZON_DAYS, MIXED, REFERENCE_SEEDS, mixedHorizon } from "./scenarios.js";
import type { Stage } from "./schema.js";
import { runOnce, type RunResult } from "./simulate.js";

const STAGES: readonly Stage[] = ["stage1", "stage2", "stage3"];

export function creditLoss(run: RunResult): number {
  return run.reserveAbsorbed + run.juniorLoss + run.creditLossEquity + run.seniorLoss;
}

/** Reserve still posted plus reserve already used. Undone posts are not included. */
export function reservePosted(run: RunResult): number {
  return run.reserveLeft + run.reserveAbsorbed;
}

/** Floor share of credit loss taken by the reserve. Null when the path lost nothing. */
export function coverageBps(run: RunResult): number | null {
  const loss = creditLoss(run);
  if (loss <= 0) return null;
  return Math.floor((run.reserveAbsorbed * 10_000) / loss);
}

export function runHorizon(seeds: readonly number[] = REFERENCE_SEEDS): RunResult[] {
  const scenario = mixedHorizon(HORIZON_DAYS);
  const runs: RunResult[] = [];
  for (const stage of STAGES) {
    for (const seed of seeds) runs.push(runOnce(stage, scenario, seed, false));
  }
  return runs;
}

function ofStage(runs: readonly RunResult[], stage: Stage): RunResult[] {
  return runs.filter((run) => run.stage === stage);
}

function spill(run: RunResult): number {
  return run.juniorLoss + run.creditLossEquity + run.seniorLoss;
}

function money(values: readonly number[]): string {
  if (values.length === 0) return "| — | — | — | — | — | — |";
  const sorted = [...values].sort((a, b) => a - b);
  const cells = [sorted[0]!, percentile(values, 25), median(values), percentile(values, 75), sorted[sorted.length - 1]!];
  return `| ${cells.map(usd).join(" | ")} |`;
}

function share(part: number, total: number): string {
  if (total <= 0) return "no loss";
  return pctFromBps(Math.floor((part * 10_000) / total));
}

export function renderHorizon(runs: readonly RunResult[]): string {
  if (runs.length === 0) return "# SUMMARY\n\nNo long-horizon paths were produced.\n";
  const days = runs[0]!.horizonDays;
  const seeds = [...new Set(runs.map((run) => run.seed))].sort((a, b) => a - b);
  const lines = [
    "# SUMMARY",
    "",
    `${runs.length} paths, ${days} days, ${seeds.length} deterministic seeds, stages 1–3, one mixed-shock calendar. Every completed path kept the accounting identity, repaid advances before waiting investors, stayed inside 25–1500 bps, and moved 0 partner-vault tokens to Lockgate. The runner throws on a breach. This is not a forecast.`,
    "",
    "Credit loss is reserve absorbed plus junior loss plus equity credit loss plus senior loss. Coverage is `floor(reserve absorbed × 10000 / credit loss)` on paths that lost something. A path with no credit loss is counted on its own. Posted reserve is cash still reserved plus cash the reserve already absorbed.",
    "",
    `Stage 1 and stage 3 post each platform's reserve budget on day 0, then the budget is zero. Stage 2 posts reserve only as a draw requires it. The 5–10% first-loss band is the platform reserve rate. The ${days}-day length, the dates below, and the two named defaulters are placement assumptions. The depeg factor 0.92, the 12× arrival burst, and the 0.5 coverage factor are the same assumption values as the single-shock book.`,
    "",
    "## Calendar",
    "",
    "```mermaid",
    "flowchart LR",
    "  gates[Gates repeat each 360-day block] --> depeg[Days 360-420 depeg]",
    "  depeg --> rush[Days 720-750 bank-run]",
    "  names[p00 and p01 miss every window] --> gates",
    "```",
    "",
    "| Window | What is on |",
    "|---|---|",
    "| Each 360-day block, year-days 1–90 | Quarterly platforms are gated |",
    "| Each block, year-days 40–70 | Epoch platforms are gated |",
    `| Days ${MIXED.depegStart}–${MIXED.depegEnd} | Coverage ×${MIXED.depegFactor}. Miss limit 3, except the named defaulters |`,
    `| Days ${MIXED.runStart}–${MIXED.runEnd} | Arrivals ×${MIXED.runMultiplier}, coverage ×${MIXED.runCoverage}, run-gated platforms close. Miss limit 2, except the named defaulters |`,
    `| Every day | Mild shortfall can inject 75% on a non-quarterly window. The first ${MIXED.defaultCount} platforms have miss limit 1 |`,
    "",
    `Seeds: ${seeds.join(", ")}.`,
    "",
    "## Reserve coverage",
    "",
    "Median coverage uses only paths with a credit loss. p25 and p75 are nearest rank: `ceil(p/100 × n)`. The median is the same even-count floor average as `RESULTS.md`.",
    "",
    "| stage | paths | no loss | reserve only | spilled | senior hit | median posted | median left | median coverage |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...STAGES.map((stage) => coverageRow(stage, ofStage(runs, stage))),
    "",
    "## Loss distribution",
    "",
    "Credit loss across seeds:",
    "",
    "| stage | min | p25 | median | p75 | max |",
    "|---|---:|---:|---:|---:|---:|",
    ...STAGES.map((stage) => `| ${stage} ${money(ofStage(runs, stage).map(creditLoss))}`),
    "",
    "Sum of each tranche across the seeds. The percent is `floor(tranche × 10000 / total)`.",
    "",
    "| stage | reserve | junior | equity | senior | total |",
    "|---|---:|---:|---:|---:|---:|",
    ...STAGES.map((stage) => trancheRow(stage, ofStage(runs, stage))),
    "",
    "## Each path",
    "",
    "| stage | seed | credit loss | reserve | junior | equity | senior | coverage | reserve left |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...[...runs]
      .sort((a, b) => a.stage.localeCompare(b.stage) || a.seed - b.seed)
      .map(pathRow),
    "",
  ];
  return lines.join("\n");
}

function coverageRow(stage: Stage, group: readonly RunResult[]): string {
  const losses = group.filter((run) => creditLoss(run) > 0);
  const ratios = losses.map((run) => coverageBps(run) ?? 0);
  const covered = pctFromBps(median(ratios));
  const label = losses.length === 0 ? "no loss" : covered;
  return `| ${stage} | ${group.length} | ${group.filter((run) => creditLoss(run) === 0).length} | ${losses.filter((run) => spill(run) === 0).length} | ${group.filter((run) => spill(run) > 0).length} | ${group.filter((run) => run.seniorLoss > 0).length} | ${usd(median(group.map(reservePosted)))} | ${usd(median(group.map((run) => run.reserveLeft)))} | ${label} |`;
}

function trancheRow(stage: Stage, group: readonly RunResult[]): string {
  const reserve = sum(group.map((run) => run.reserveAbsorbed));
  const junior = sum(group.map((run) => run.juniorLoss));
  const equity = sum(group.map((run) => run.creditLossEquity));
  const senior = sum(group.map((run) => run.seniorLoss));
  const total = reserve + junior + equity + senior;
  const cell = (n: number) => `${usd(n)} (${share(n, total)})`;
  return `| ${stage} | ${cell(reserve)} | ${cell(junior)} | ${cell(equity)} | ${cell(senior)} | ${usd(total)} |`;
}

function pathRow(run: RunResult): string {
  const ratio = coverageBps(run);
  const covered = ratio === null ? "no loss" : pctFromBps(ratio);
  return `| ${run.stage} | ${run.seed} | ${usd(creditLoss(run))} | ${usd(run.reserveAbsorbed)} | ${usd(run.juniorLoss)} | ${usd(run.creditLossEquity)} | ${usd(run.seniorLoss)} | ${covered} | ${usd(run.reserveLeft)} |`;
}
