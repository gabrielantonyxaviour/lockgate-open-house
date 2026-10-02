import { coverageBps, creditLoss, reservePosted } from "./horizon.js";
import { scenarioSet } from "./scenarios.js";
import { scenarioSchema, type Scenario, type Stage } from "./schema.js";
import { runOnce, type RunResult } from "./simulate.js";
import { buildWorld } from "./world.js";

/** One weekly, one epoch, one quarterly. Ids follow buildWorld index order. */
export const TRI_GATE_IDS = ["p00", "p18", "p30"] as const;
/** Shared window. Scheduled mode would gate every epoch and quarterly platform, and no weekly platform. */
export const TRI_GATE_START = 1;
export const TRI_GATE_END = 90;

const STAGES: readonly Stage[] = ["stage1", "stage2", "stage3"];

export function triGateScenario(horizonDays: number, baseName: "baseline" | "default" = "baseline"): Scenario {
  const base = scenarioSet(horizonDays).find((row) => row.name === baseName);
  if (!base) throw new Error(`${baseName} scenario missing`);
  return scenarioSchema.parse({
    ...base,
    name: "tri-gate",
    gateMode: "none",
    bankRunGates: false,
    gateIds: [...TRI_GATE_IDS],
    gateStart: TRI_GATE_START,
    gateEnd: TRI_GATE_END,
  });
}

export type TriRow = {
  id: "baseline" | "default";
  stage: Stage;
  advanced: number;
  gated: number;
  hits: readonly [number, number, number];
  otherHits: number;
  mandateLimit: number;
  mandateConcentration: number;
  overLimit: number;
  creditLoss: number;
  reserveAbsorbed: number;
  reserveLeft: number;
  reservePosted: number;
  coverageBps: number | null;
  seniorLoss: number;
  juniorLoss: number;
  creditLossEquity: number;
  platformPeak: number;
  harbourPeak: number;
  keppelPeak: number;
  marinaPeak: number;
  concentrationGaps: number;
  maxConcentrationGap: number;
  /** Days when every named platform took a gated refusal. */
  sameDayGates: number;
  sameDayOn: readonly number[];
};

function maxValue(map: Record<string, number>): number {
  let n = 0;
  for (const value of Object.values(map)) if (value > n) n = value;
  return n;
}

function vaultPeak(map: Record<string, number>, vault: string): number {
  const prefix = `${vault}:`;
  let n = 0;
  for (const [key, owed] of Object.entries(map)) {
    if (key.startsWith(prefix) && owed > n) n = owed;
  }
  return n;
}

export function triRow(id: "baseline" | "default", run: RunResult): TriRow {
  const hits = TRI_GATE_IDS.map((platform) => run.gatedHits[platform] ?? 0) as [number, number, number];
  let otherHits = 0;
  for (const platform of Object.keys(run.gatedHits)) {
    if (!TRI_GATE_IDS.includes(platform as (typeof TRI_GATE_IDS)[number])) otherHits += run.gatedHits[platform] ?? 0;
  }
  return {
    id,
    stage: run.stage,
    advanced: run.advanced,
    gated: run.rejected.gated ?? 0,
    hits,
    otherHits,
    mandateLimit: run.rejected["mandate-limit"] ?? 0,
    mandateConcentration: run.rejected["mandate-concentration"] ?? 0,
    overLimit: run.rejected["over-limit"] ?? 0,
    creditLoss: creditLoss(run),
    reserveAbsorbed: run.reserveAbsorbed,
    reserveLeft: run.reserveLeft,
    reservePosted: reservePosted(run),
    coverageBps: coverageBps(run),
    seniorLoss: run.seniorLoss,
    juniorLoss: run.juniorLoss,
    creditLossEquity: run.creditLossEquity,
    platformPeak: maxValue(run.exposurePeaks.platform),
    harbourPeak: vaultPeak(run.exposurePeaks.mandate, "Harbour"),
    keppelPeak: vaultPeak(run.exposurePeaks.mandate, "Keppel"),
    marinaPeak: vaultPeak(run.exposurePeaks.mandate, "Marina"),
    concentrationGaps: Object.keys(run.exposurePeaks.concentrationGap).length,
    maxConcentrationGap: maxValue(run.exposurePeaks.concentrationGap),
    sameDayGates: run.sameDayGateDays,
    sameDayOn: run.sameDayGateOn,
  };
}

function sameDaySentence(rows: readonly TriRow[]): string {
  const listed = rows.map((row) => row.sameDayOn.join(","));
  const unique = [...new Set(listed)];
  const windowDays = TRI_GATE_END - TRI_GATE_START + 1;
  if (unique.length === 1) {
    const days = rows[0]?.sameDayOn ?? [];
    const when = days.length === 0 ? "none" : `day ${days.join(", ")}`;
    return `Every listed book records ${days.length} day${days.length === 1 ? "" : "s"} in the ${windowDays}-day window when p00, p18, and p30 each received a gated refusal: ${when}.`;
  }
  return `Same-day gated refusals differ by row: ${rows.map((row) => `${row.id} ${row.stage} ${row.sameDayOn.join("+") || "none"}`).join("; ")}.`;
}

/** Baseline and default books with the same three gates. Does not write RESULTS.md. */
export function runTriGateBook(seed: number, horizonDays: number): TriRow[] {
  const rows: TriRow[] = [];
  for (const stage of STAGES) {
    rows.push(triRow("baseline", runOnce(stage, triGateScenario(horizonDays), seed, false)));
    rows.push(triRow("default", runOnce(stage, triGateScenario(horizonDays, "default"), seed, false)));
  }
  return rows;
}

function cell(bps: number | null): string {
  return bps === null ? "no loss" : String(bps);
}

function outcome(rows: readonly TriRow[], cap: { harbour: number; keppel: number; marina: number }): string {
  const named = rows.every((row) => row.hits.every((hit) => hit > 0) && row.otherHits === 0);
  const clean = rows.filter((row) => row.id === "baseline").every((row) => row.coverageBps === null && row.reserveAbsorbed === 0);
  const cover = rows.filter((row) => row.id === "default").map((row) => cell(row.coverageBps)).join(", ");
  const senior = rows.every((row) => row.seniorLoss === 0);
  const stage2 = rows.filter((row) => row.stage === "stage2");
  const under = stage2.every((row) => row.harbourPeak <= cap.harbour && row.keppelPeak <= cap.keppel && row.marinaPeak <= cap.marina);
  const gaps = rows.every((row) => row.concentrationGaps === 0);
  return [
    named ? "Each of p00, p18, and p30 records a gated refusal. No other platform does." : "The gate list did not stay on those three platforms.",
    clean ? "Baseline coverage is no loss." : "Baseline coverage is not no loss.",
    `Default coverage is ${cover}.`,
    senior ? "Senior loss is 0 on every row." : "Senior loss is not 0.",
    under ? "Stage 2 peaks sit under the three mandate caps." : "A stage 2 peak crosses a mandate cap.",
    gaps ? "Concentration gaps are 0." : "A concentration gap was recorded.",
  ].join(" ");
}

function caps(): { platform: number; harbour: number; keppel: number; marina: number } {
  const world = buildWorld("stage2", 1);
  const limit = (id: string) => world.vaults.find((vault) => vault.id === id)?.mandate.limit ?? 0;
  return {
    platform: world.platforms[0]?.limit ?? 0,
    harbour: limit("Harbour"),
    keppel: limit("Keppel"),
    marina: limit("Marina"),
  };
}

/** Catalog. Pass the rows from runTriGateBook. This does not run them again. */
export function renderConcurrent(rows: readonly TriRow[], seed: number, horizonDays: number): string {
  const cap = caps();
  const lines = [
    "# SUMMARY",
    "",
    `Three platforms gate together on seed ${seed}, ${horizonDays} days, stages 1–3. p00 is weekly, p18 is epoch, and p30 is quarterly. The shared window is days ${TRI_GATE_START}–${TRI_GATE_END}. No other platform is on that list. Gate mode is none, so the scheduled rule does not also close every epoch and quarterly platform. A weekly platform is closed here. The scheduled scenario leaves weekly platforms open. The five-name scenario set is unchanged. The 0.92 window-cash factor is not applied.`,
    "",
    sameDaySentence(rows),
    "",
    "A gated day refuses a new advance and still runs that platform's window. Coverage is floor(reserve absorbed × 10000 / credit loss). A path with no credit loss is no loss. Posted reserve is cash still reserved plus cash the reserve already absorbed. The day loop throws if booked owed nav crosses a platform cap or, on stage 2, a vault mandate cap. Concentration is a pre-trade check. A later gap means assets shrank after a draw that was inside the cap. It is not a new advance.",
    "",
    "```mermaid",
    "flowchart LR",
    "  trio[p00 p18 and p30] --> shut[Days 1-90 refuse new advances]",
    "  rest[The other 33 platforms] --> open[Same days stay open]",
    "  shut --> book[Reserve and mandate caps still checked]",
    "  open --> book",
    "```",
    "",
    `| Cap | Platform owed nav | Harbour mandate | Keppel mandate | Marina mandate |`,
    `|---|---|---|---|---|`,
    `| Micro-USDG | ${cap.platform} | ${cap.harbour} | ${cap.keppel} | ${cap.marina} |`,
    "",
    "| Book | Stage | Advances | Gated | p00 | p18 | p30 | Other gated | Mandate-limit refusals | Concentration refusals | Over-limit refusals | Credit loss | Reserve absorbed | Reserve posted | Coverage bps | Platform peak | Harbour / Keppel / Marina | Concentration gaps | Largest gap |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.id} | ${row.stage} | ${row.advanced} | ${row.gated} | ${row.hits[0]} | ${row.hits[1]} | ${row.hits[2]} | ${row.otherHits} | ${row.mandateLimit} | ${row.mandateConcentration} | ${row.overLimit} | ${row.creditLoss} | ${row.reserveAbsorbed} | ${row.reservePosted} | ${cell(row.coverageBps)} | ${row.platformPeak} | ${row.harbourPeak} / ${row.keppelPeak} / ${row.marinaPeak} | ${row.concentrationGaps} | ${row.maxConcentrationGap} |`),
    "",
    outcome(rows, cap),
    "",
    "Stage 1 and stage 3 have no partner mandate, so Harbour, Keppel, and Marina peaks stay 0. The platform owed-nav cap still applies. Stage 2 checks each vault. The default book still names the first four platforms as defaulters. p00 is both gated and a defaulter there. Once it is dead, a later ask is defaulted rather than gated. Posted reserve equals reserve left plus reserve absorbed.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}
