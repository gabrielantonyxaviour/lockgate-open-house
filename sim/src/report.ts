import { median, pctFromBps, usd } from "./format.js";
import type { RunResult } from "./simulate.js";

const STAGES = ["stage1", "stage2", "stage3"] as const;
const SHOCKS = ["baseline", "gating", "default", "depeg", "bank-run"] as const;

function rows(runs: readonly RunResult[], stage: string, scenario: string): RunResult[] {
  return runs.filter((run) => run.stage === stage && run.scenario === scenario);
}

export function renderReport(runs: readonly RunResult[], illustratedSeed: number): string {
  const illustrated = runs.filter((run) => run.seed === illustratedSeed);
  const base = illustrated.find((run) => run.stage === "stage1" && run.scenario === "baseline");
  const bank = illustrated.find((run) => run.stage === "stage1" && run.scenario === "bank-run");
  const partner = illustrated.find((run) => run.stage === "stage2" && run.scenario === "baseline");
  const facility = illustrated.find((run) => run.stage === "stage3" && run.scenario === "bank-run");
  if (!base || !bank || !partner || !facility) {
    return "# SUMMARY\n\nThe run did not produce the illustrated paths.\n";
  }
  const seeds = new Set(runs.map((run) => run.seed)).size;
  const seniorHits = runs.filter((run) => run.seniorLoss > 0).length;
  const lines = [
    "# SUMMARY",
    "",
    `Reference book, ${base.horizonDays} days, 36 platforms, ${seeds} seeds, stages 1–3, five shocks. Every completed path kept the accounting identity, repaid advances before waiting investors, charged 25–1500 bps, and moved 0 partner-vault tokens to Lockgate. The runner throws on a breach, so a finished table is the check.`,
    "",
    `Illustrated seed ${illustratedSeed}, stage 1 baseline: ${base.advanced.toLocaleString("en-US")} advances out of ${base.requested.toLocaleString("en-US")} exit requests, peak utilization ${pctFromBps(base.peakUtilBps)}, annualized exit-fee yield ${pctFromBps(base.feeYieldBps ?? 0)} on average equity, credit losses ${usd(base.reserveAbsorbed + base.creditLossEquity)}. The same seed's bank-run peaks at ${pctFromBps(bank.peakUtilBps)} utilization. Stage 2 baseline invoices ${usd(partner.techFee)} as a flat technology fee and does not sweep it from the vaults. Stage 3 bank-run senior loss on that seed is ${usd(facility.seniorLoss)}; senior was impaired on ${seniorHits} of ${runs.length} paths, and only after junior was exhausted.`,
    "",
    "Stage 3 fee yield is gross exit fees divided by average equity value. That equity is 500,000 USDG, levered by the senior and junior facility. The percentage is not a net return. Facility interest is reported beside it and is not subtracted.",
    "",
    "These are outputs of the assumptions below. They are not a forecast and not a measured market.",
    "",
    "## Setup",
    "",
    "Platforms follow the queue shapes in the product notes. Eighteen clear weekly, the way Kasu's pending pool pays from excess cash on a weekly cycle. Twelve clear on a 30-day epoch, the cadence of the USD.AI queue write-up. Six are quarterly and can pay at most 5% of an assumed 800,000 USDG book each window, from the internal decision to treat large gated funds as a 5%-a-quarter redemption. Sources are listed at the bottom.",
    "",
    "Each day, redemption requests arrive, 70% ask to exit early, and the rest wait. A window injects cash against what is due, pays Lockgate advances FIFO, and only then pays waiting investors. Unpaid advances roll to the next window. They are written off after a miss limit and a 2-day grace: 8 misses in the baseline, 1 for the four named defaulters, 3 in the depeg, 2 in the bank-run. A write-off takes that platform's own reserve first, then junior cash, junior principal, equity, and senior.",
    "",
    "Stage 1 is Lockgate's own 4,000,000 USDG. Stage 2 is three partner vaults of 900,000 USDG each (Harbour weekly, Keppel weekly and epoch, Marina all queues). The router takes the lowest fee that clears the mandate. Stage 3 is 500,000 USDG of equity plus a facility (senior 1,500,000 USDG at 8%, junior 400,000 USDG at 15%, advance rate 80% of principal). Coupons, the advance rate, the 2,000 USDG per vault per 30 days technology invoice, and the premium slopes are assumptions. The 12% APR, the 25/1500 bps band, the 5–10% reserve and the flat (not per-deal) fee are from the product documents.",
    "",
    "## Median across seeds",
    "",
    "Advances funded:",
    "",
    numTable(runs, (run) => run.advanced, (n) => n.toLocaleString("en-US")),
    "",
    "Peak utilization:",
    "",
    numTable(runs, (run) => run.peakUtilBps, pctFromBps),
    "",
    "Annualized exit-fee yield on average equity value. Stage 2 is the partners' yield. Lockgate's stage-2 income is the flat invoice, not this column:",
    "",
    numTable(runs, (run) => run.feeYieldBps ?? 0, pctFromBps),
    "",
    "Credit loss (reserve absorbed + junior + equity credit loss + senior), median:",
    "",
    numTable(runs, (run) => run.reserveAbsorbed + run.juniorLoss + run.creditLossEquity + run.seniorLoss, usd),
    "",
    "Stage 3 also pays facility interest out of equity. Median interest and median senior loss:",
    "",
    interestTable(runs),
    "",
    "## Illustrated seed",
    "",
    illustratedTable(illustrated),
    "",
    rejectionBlock(base),
    "",
    "## Charts",
    "",
    "![Stage 1 utilization](charts/utilization.png)",
    "",
    "![Stage 1 cumulative credit loss](charts/losses.png)",
    "",
    "![Median annualized exit-fee yield](charts/yield.png)",
    "",
    "![Bank-run loss allocation on the illustrated seed](charts/allocation.png)",
    "",
    "## Reproduce",
    "",
    "```",
    "cd lockgate/repo/sim && npm test && npm run sim",
    "```",
    "",
    "## Sources",
    "",
    "- 12% APR, 25 bps floor, 1500 bps cap, demo time scale 4320, repay-first window, 7.5% reserve seed, USDG address: `lockgate/SPEC.md`.",
    "- About 1% per month and the 5%-a-quarter gated-fund decision: `lockgate/ideation/DECISIONS.md` (28 Sep and 27 Sep 2026).",
    "- Stages, 5–10% first-loss reserve, flat technology fee, Lockgate holds no partner keys: `briefs/grok/PRODUCT.md`.",
    "- Kasu weekly cycle, positions not transferable: [PendingPool.sol](https://github.com/Kasu-Finance/kasu-contracts/blob/master/src/core/lendingPool/PendingPool.sol), discussed in `research/lockgate-exit-precedents.md`.",
    "- USD.AI monthly queue (QEV still described as not implemented): [queue-extractable-value](https://docs.usd.ai/depositor/susdai/queue-extractable-value.md).",
    "- Global Dollar (USDG) on Arbitrum Sepolia, 6 decimals, proxy at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`: [Arbiscan](https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892). On 2026-10-01, `cast` against `https://sepolia-rollup.arbitrum.io/rpc` at block 314719112 returned symbol USDG, decimals 6, totalSupply 2111011000100 (2,111,011.0001 USDG), chain id 421614.",
    "",
  ];
  return lines.join("\n");
}

function numTable(runs: readonly RunResult[], pick: (run: RunResult) => number, format: (n: number) => string): string {
  const header = `| | ${SHOCKS.join(" | ")} |`;
  const sep = `|---|${SHOCKS.map(() => "---:").join("|")}|`;
  const lines = STAGES.map((stage) => {
    const shown = SHOCKS.map((shock) => format(median(rows(runs, stage, shock).map(pick))));
    return `| ${stage} | ${shown.join(" | ")} |`;
  });
  return [header, sep, ...lines].join("\n");
}

function interestTable(runs: readonly RunResult[]): string {
  const header = "| | median interest | median senior loss | paths with senior loss |";
  const sep = "|---|---:|---:|---:|";
  const lines = SHOCKS.map((shock) => {
    const group = rows(runs, "stage3", shock);
    const interest = median(group.map((run) => run.interestExpense));
    const senior = median(group.map((run) => run.seniorLoss));
    const hits = group.filter((run) => run.seniorLoss > 0).length;
    return `| ${shock} | ${usd(interest)} | ${usd(senior)} | ${hits}/${group.length} |`;
  });
  return [header, sep, ...lines].join("\n");
}

function illustratedTable(runs: readonly RunResult[]): string {
  const header = "| stage | shock | advanced | peak util | fee yield | reserve | junior | equity loss | senior | tech fee |";
  const sep = "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  const lines = runs.map((run) =>
    `| ${run.stage} | ${run.scenario} | ${run.advanced} | ${pctFromBps(run.peakUtilBps)} | ${pctFromBps(run.feeYieldBps ?? 0)} | ${usd(run.reserveAbsorbed)} | ${usd(run.juniorLoss)} | ${usd(run.creditLossEquity)} | ${usd(run.seniorLoss)} | ${usd(run.techFee)} |`,
  );
  return [header, sep, ...lines].join("\n");
}

function rejectionBlock(run: RunResult): string {
  const entries = Object.entries(run.rejected).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "Stage 1 baseline on the illustrated seed rejected no requests.";
  const lines = entries.map(([reason, count]) => `- ${reason}: ${count}`);
  return ["Stage 1 baseline rejections on the illustrated seed:", "", ...lines].join("\n");
}
