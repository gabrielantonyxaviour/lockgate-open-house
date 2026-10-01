import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./errors.js";
import { renderReport } from "./report.js";
import { runRequestSchema, stageSchema, type Stage } from "./schema.js";
import { scenarioSet } from "./scenarios.js";
import { runOnce, type RunResult } from "./simulate.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const request = runRequestSchema.parse({
  horizonDays: 360,
  seeds: [20261001, 20261002, 20261003, 20261004, 20261005, 20261006, 20261007, 20261008, 20261009, 20261010],
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

const chart = spawnSync("python3", [resolve(root, "chart.py"), summary, resolve(root, "charts")], { encoding: "utf8" });
if (chart.status !== 0) {
  fail(chart.stderr || "chart render failed", "chart");
}
process.stdout.write(`sim wrote ${runs.length} paths to RESULTS.md\n`);
