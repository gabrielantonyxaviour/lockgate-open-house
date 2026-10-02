import { coverageBps, creditLoss, reservePosted } from "./horizon.js";
import { scenarioSet } from "./scenarios.js";
import { scenarioSchema, type Scenario, type Stage } from "./schema.js";
import { runOnce, type RunResult } from "./simulate.js";
import { DAY } from "./world.js";

/** 1e8 = $1, the unit of IPegOracle.latest. The floor is the one FacilityTime draws against. */
export const PAR_E8 = 100_000_000;
export const FLOOR_E8 = 99_000_000;
/** One unit under the floor. Not a market print. */
export const USDC_DEPEG_E8 = FLOOR_E8 - 1;
/** Same max age FacilityTime treats as still fresh. One second past it is stale. */
export const MAX_ORACLE_AGE = DAY;
/** Placement. Same dates as the window-cash depeg. This shock does not use the 0.92 factor. */
export const ORACLE_START = 120;
export const ORACLE_END = 150;

export type PegCode = "stale-oracle" | "peg";

export type Peg = {
  enabled: boolean;
  priceE8: number;
  updatedAt: number;
  minPriceE8: number;
  maxOracleAge: number;
};

/**
 * Same order as engine/src/pricing/peg.ts. A disabled oracle is not a depeg.
 * Stale wins over a low price, so a stale print is not also a depeg.
 */
export function pegFailure(now: number, peg: Peg | undefined): PegCode | null {
  if (!peg || !peg.enabled) return null;
  const stale = peg.updatedAt > now || peg.maxOracleAge === 0 || now - peg.updatedAt > peg.maxOracleAge;
  if (stale) return "stale-oracle";
  if (peg.priceE8 < peg.minPriceE8) return "peg";
  return null;
}

export function pegAt(scenario: Scenario, day: number): Peg | undefined {
  if (scenario.oracle === "off") return undefined;
  const now = day * DAY;
  const inside = day >= scenario.oracleStart && day <= scenario.oracleEnd;
  const priceE8 = scenario.oracle === "usdc-depeg" && inside ? USDC_DEPEG_E8 : PAR_E8;
  const age = scenario.oracle === "stale-price" && inside ? MAX_ORACLE_AGE + 1 : 0;
  return {
    enabled: true,
    priceE8,
    updatedAt: now - age,
    minPriceE8: FLOOR_E8,
    maxOracleAge: MAX_ORACLE_AGE,
  };
}

export function oracleBlock(scenario: Scenario, day: number): PegCode | null {
  return pegFailure(day * DAY, pegAt(scenario, day));
}

/** Repayment cash at the depegged price. Stale and off leave the amount unchanged. */
export function scaleRepayment(amount: number, scenario: Scenario, day: number): number {
  if (scenario.oracle !== "usdc-depeg") return amount;
  if (day < scenario.oracleStart || day > scenario.oracleEnd) return amount;
  return Math.floor((amount * USDC_DEPEG_E8) / PAR_E8);
}

export function oracleScenario(
  kind: "usdc-depeg" | "stale-price",
  horizonDays: number,
  baseName: "baseline" | "default" = "baseline",
): Scenario {
  const base = scenarioSet(horizonDays).find((row) => row.name === baseName);
  if (!base) throw new Error(`${baseName} scenario missing`);
  return scenarioSchema.parse({
    ...base,
    name: kind,
    oracle: kind,
    oracleStart: ORACLE_START,
    oracleEnd: ORACLE_END,
  });
}

export type OracleRow = {
  id: string;
  stage: Stage;
  advanced: number;
  peg: number;
  stale: number;
  creditLoss: number;
  reserveAbsorbed: number;
  reservePosted: number;
  coverageBps: number | null;
};

export function oracleRow(id: string, run: RunResult): OracleRow {
  return {
    id,
    stage: run.stage,
    advanced: run.advanced,
    peg: run.rejected.peg ?? 0,
    stale: run.rejected["stale-oracle"] ?? 0,
    creditLoss: creditLoss(run),
    reserveAbsorbed: run.reserveAbsorbed,
    reservePosted: reservePosted(run),
    coverageBps: coverageBps(run),
  };
}

const STAGES: readonly Stage[] = ["stage1", "stage2", "stage3"];

/** Baseline and default books, each with both shocks, three stages. Does not write RESULTS.md. */
export function runOracleBook(seed: number, horizonDays: number): OracleRow[] {
  const set = scenarioSet(horizonDays);
  const baseline = set.find((row) => row.name === "baseline");
  const stressed = set.find((row) => row.name === "default");
  if (!baseline || !stressed) throw new Error("scenario set is missing a book");
  const rows: OracleRow[] = [];
  for (const stage of STAGES) {
    rows.push(oracleRow("baseline", runOnce(stage, baseline, seed, false)));
    rows.push(oracleRow("usdc-depeg", runOnce(stage, oracleScenario("usdc-depeg", horizonDays), seed, false)));
    rows.push(oracleRow("stale-price", runOnce(stage, oracleScenario("stale-price", horizonDays), seed, false)));
    rows.push(oracleRow("default", runOnce(stage, stressed, seed, false)));
    rows.push(oracleRow("default-usdc-depeg", runOnce(stage, oracleScenario("usdc-depeg", horizonDays, "default"), seed, false)));
    rows.push(oracleRow("default-stale-price", runOnce(stage, oracleScenario("stale-price", horizonDays, "default"), seed, false)));
  }
  return rows;
}

function cell(bps: number | null): string {
  return bps === null ? "no loss" : String(bps);
}

function rowAt(rows: readonly OracleRow[], id: string, stage: Stage): OracleRow | undefined {
  return rows.find((row) => row.id === id && row.stage === stage);
}

/** Expected coverage, written from the rows so the sentence cannot drift from the table. */
function outcome(rows: readonly OracleRow[]): string {
  const parts: string[] = [];
  for (const stage of STAGES) {
    const clean = rowAt(rows, "baseline", stage);
    const usdc = rowAt(rows, "usdc-depeg", stage);
    const stale = rowAt(rows, "stale-price", stage);
    const hit = rowAt(rows, "default", stage);
    const hitUsdc = rowAt(rows, "default-usdc-depeg", stage);
    const hitStale = rowAt(rows, "default-stale-price", stage);
    if (!clean || !usdc || !stale || !hit || !hitUsdc || !hitStale) return "The book is incomplete.";
    const same =
      hit.coverageBps === hitUsdc.coverageBps &&
      hit.coverageBps === hitStale.coverageBps &&
      hit.creditLoss === hitUsdc.creditLoss &&
      hit.creditLoss === hitStale.creditLoss &&
      hit.reserveAbsorbed === hitUsdc.reserveAbsorbed &&
      hit.reserveAbsorbed === hitStale.reserveAbsorbed;
    const posted = new Set([
      clean.reservePosted,
      usdc.reservePosted,
      stale.reservePosted,
      hit.reservePosted,
      hitUsdc.reservePosted,
      hitStale.reservePosted,
    ]).size;
    const noun = posted === 1 ? "value" : "values";
    parts.push(
      `${stage} clean coverage is ${cell(clean.coverageBps)} (USDC ${cell(usdc.coverageBps)}, stale ${cell(stale.coverageBps)}). Default coverage is ${cell(hit.coverageBps)} and ${same ? "stays the same under both shocks" : "changes under a shock"}. Posted reserve has ${posted} distinct ${noun}.`,
    );
  }
  const usdc = rows.filter((row) => row.id === "usdc-depeg" || row.id === "default-usdc-depeg");
  const stale = rows.filter((row) => row.id === "stale-price" || row.id === "default-stale-price");
  const pegs = [...new Set(usdc.map((row) => row.peg))].join(" / ");
  const quiet = [...new Set(usdc.map((row) => row.stale))].join(" / ");
  const ages = [...new Set(stale.map((row) => row.stale))].join(" / ");
  const other = [...new Set(stale.map((row) => row.peg))].join(" / ");
  parts.push(
    `USDC depeg peg refusals are ${pegs} and stale refusals are ${quiet}. Stale-price stale refusals are ${ages} and peg refusals are ${other}.`,
  );
  return parts.join(" ");
}

/** Catalog. Pass the rows from runOracleBook. This does not run them again. */
export function renderOracle(rows: readonly OracleRow[], seed: number, horizonDays: number): string {
  const lines = [
    "# SUMMARY",
    "",
    `Oracle and price shocks on seed ${seed}, ${horizonDays} days, stages 1–3. The USDC depeg shock prices injected window cash at ${USDC_DEPEG_E8}, one unit under the ${FLOOR_E8} floor, and refuses a new advance with peg. A stale price keeps that cash at par and refuses a new advance with stale-oracle. Days ${ORACLE_START}–${ORACLE_END} are the shock. Days outside it are open. The check order matches engine/src/pricing/peg.ts, so a stale print is not also reported as a peg. IPegOracle is a USDG/USD price, 1e8 = $1, and the engine reports a price under the floor as "USDG is below the peg floor". This sim does not call latest(). ${USDC_DEPEG_E8} is the floor minus one unit, not a market print and not a forecast. The 0.92 window-cash depeg is a different scenario and is not applied here.`,
    "",
    "Coverage is floor(reserve absorbed × 10000 / credit loss). A path with no credit loss is no loss. Posted reserve is cash still reserved plus cash the reserve already absorbed.",
    "",
    "```mermaid",
    "flowchart LR",
    "  price[USDC price under the floor] --> haircut[Window cash times that price]",
    "  price --> stop[New advances refused]",
    "  stale[Oracle age one second past 1 day] --> stop2[New advances refused]",
    "  stale --> par[Window cash stays at par]",
    "```",
    "",
    "| Shock | Stage | Advances | Peg refusals | Stale refusals | Credit loss | Reserve absorbed | Reserve posted | Coverage bps |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.id} | ${row.stage} | ${row.advanced} | ${row.peg} | ${row.stale} | ${row.creditLoss} | ${row.reserveAbsorbed} | ${row.reservePosted} | ${cell(row.coverageBps)} |`),
    "",
    outcome(rows),
    "",
    "A price equal to the floor is still good. One unit under it is peg. An age equal to 1 day is still fresh. One second later is stale-oracle, including when the price is also under the floor.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}
