import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./errors.js";
import { renderAdversarial } from "./actors.js";
import { renderHorizon, runHorizon } from "./horizon.js";
import { renderReport } from "./report.js";
import { runRequestSchema, stageSchema, type Stage } from "./schema.js";
import { REFERENCE_SEEDS, scenarioSet } from "./scenarios.js";
import { runOnce, type RunResult } from "./simulate.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const request = runRequestSchema.parse({
  horizonDays: 360,
  seeds: [...REFERENCE_SEEDS],
});
const stages = ["stage1", "stage2", "stage3"].map((stage) => stageSchema.parse(stage));
const illustrated = request.seeds[0]!;
const runs: RunResult[] = [];

for (const stage of stages) {
  for (const scenario of scenarioSet(request.horizonDays)) {
    for (const seed of request.seeds) {
      runs.push(runOnce(stage as Stage, scenario, seed, seed === illustrated));
    }
  }
}

const payload = {
  illustratedSeed: illustrated,
  horizonDays: request.horizonDays,
  seeds: request.seeds,
  runs,
};
mkdirSync(resolve(root, "out"), { recursive: true });
mkdirSync(resolve(root, "charts"), { recursive: true });
const summary = resolve(root, "out", "summary.json");
writeFileSync(summary, JSON.stringify(payload));
writeFileSync(resolve(root, "RESULTS.md"), renderReport(runs, illustrated));
writeFileSync(resolve(root, "ADVERSARIAL.md"), renderAdversarial());
const horizonRuns = runHorizon();
writeFileSync(resolve(root, "HORIZON.md"), renderHorizon(horizonRuns));
writeFileSync(resolve(root, "out", "horizon.json"), JSON.stringify({ horizonDays: horizonRuns[0]?.horizonDays ?? 0, runs: horizonRuns }));

const chart = spawnSync("python3", [resolve(root, "chart.py"), summary, resolve(root, "charts")], { encoding: "utf8" });
if (chart.status !== 0) {
  fail(chart.stderr || "chart render failed", "chart");
}
process.stdout.write(`sim wrote ${runs.length} paths to RESULTS.md and ${horizonRuns.length} paths to HORIZON.md\n`);
