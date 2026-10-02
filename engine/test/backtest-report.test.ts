import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordedScenarios } from "../src/backtest/catalog.js";
import { runBacktest } from "../src/backtest/harness.js";
import {
  buildBacktestBundle,
  recordedBacktestBundle,
  renderBacktestJson,
  renderBacktestMarkdown,
  writeBacktestReport,
  type BacktestBundle,
} from "../src/backtest/publish.js";
import { SCENARIOS } from "../src/backtest/scenarios.js";
import { run } from "../src/cli.js";
import { paramsSchema } from "../src/domain.js";
import { EngineError } from "../src/errors.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";

const params = paramsSchema.parse(DEFAULT_PARAMS);
const SOURCE = "https://example.com/lockgate-recorded-tape";

function epoch(bundle: BacktestBundle) {
  return bundle.scenarios.find((scenario) => scenario.name === "epoch-repay");
}

describe("backtest report", () => {
  it("flags every recorded scenario synthetic and matches the pricer", () => {
    const bundle = recordedBacktestBundle(params);
    expect(bundle.kind).toBe("backtest-report");
    expect(bundle.parameters.origin).toBe("synthetic");
    expect(bundle.parameters.source).toBeNull();
    expect(bundle.parameters.value.timeScale).toBe(DEFAULT_PARAMS.timeScale);
    expect(bundle.parameters.value.aprAtKinkBps).toBe(DEFAULT_PARAMS.aprAtKinkBps);
    expect(bundle.scenarios.map((scenario) => scenario.name)).toEqual(Object.keys(SCENARIOS));
    expect(bundle.scenarios.every((scenario) => scenario.origin === "synthetic" && scenario.source === null)).toBe(true);

    for (const scenario of bundle.scenarios) {
      const name = scenario.name as keyof typeof SCENARIOS;
      const raw = runBacktest(SCENARIOS[name](), params);
      expect(scenario.feeEarned).toBe(raw.feeEarned.toString());
      expect(scenario.loss).toBe(raw.loss.toString());
      expect(scenario.reserveUsed).toBe(raw.reserveUsed.toString());
      expect(scenario.advanced).toBe(raw.advanced);
      expect(scenario.refused).toBe(raw.refused);
      expect(scenario.mismatches).toBe(raw.mismatches);
      expect(scenario.ticks.every((tick) => tick.origin === "synthetic" && tick.source === null)).toBe(true);
    }

    const row = epoch(bundle);
    expect(row?.feeEarned).toBe("109000000");
    expect(row?.loss).toBe("0");
    expect(row?.refused).toBe(0);
    expect(row?.ticks[0]).toMatchObject({
      platformId: "harbor-epoch-credit",
      kind: "epoch",
      feeBps: 109,
      fee: "109000000",
      payout: "9891000000",
      available: true,
    });
    const gated = bundle.scenarios.find((scenario) => scenario.name === "gated-refuse");
    expect(gated?.refused).toBe(1);
    expect(gated?.feeEarned).toBe("0");
    const busy = bundle.scenarios.find((scenario) => scenario.name === "busy-book");
    expect(BigInt(busy?.feeEarned ?? "0")).toBeGreaterThan(109000000n);
    const slashed = bundle.scenarios.find((scenario) => scenario.name === "kasu-repay-slash");
    expect(BigInt(slashed?.loss ?? "0")).toBeGreaterThan(0n);

    const markdown = renderBacktestMarkdown(bundle);
    expect(markdown).toContain("| epoch-repay | synthetic |");
    expect(markdown).toContain("| 109000000 |");
    expect(markdown).toContain("Source: none.");
    expect(markdown).not.toMatch(/https?:\/\//);
    const parsed = JSON.parse(renderBacktestJson(bundle)) as BacktestBundle;
    expect(parsed.scenarios).toEqual(bundle.scenarios);
    expect(parsed.parameters.origin).toBe("synthetic");
  });

  it("keeps a sourced URL and rejects a missing or laundered citation", () => {
    const [first] = recordedScenarios();
    const bundle = buildBacktestBundle([{
      name: "cited-book",
      ticks: first?.ticks ?? [],
      provenance: { origin: "sourced", source: SOURCE, note: "Caller-supplied tape for the flag." },
    }], params);
    expect(bundle.scenarios[0]?.origin).toBe("sourced");
    expect(bundle.scenarios[0]?.source).toBe(SOURCE);
    expect(bundle.scenarios[0]?.ticks[0]?.origin).toBe("sourced");
    const markdown = renderBacktestMarkdown(bundle);
    expect(markdown).toContain("| cited-book | sourced |");
    expect(markdown).toContain(SOURCE);
    expect(bundle.parameters.origin).toBe("synthetic");

    expect(() => buildBacktestBundle([{
      name: "cited-book",
      ticks: first?.ticks ?? [],
      provenance: { origin: "sourced", note: "No URL." },
    }], params)).toThrow(EngineError);
    expect(() => buildBacktestBundle([{
      name: "cited-book",
      ticks: first?.ticks ?? [],
      provenance: { origin: "synthetic", source: SOURCE, note: "Round test book." },
    }], params)).toThrow(EngineError);
  });

  it("writes markdown and JSON from the CLI and skips the files on a dry run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-backtest-"));
    const result = await run(["backtest", "--scenario", "epoch-repay", "--report", dir]) as { feeEarned: bigint };
    expect(result.feeEarned).toBe(109000000n);
    expect(readdirSync(dir).sort()).toEqual(["backtest-report.json", "backtest-report.md"]);
    const saved = JSON.parse(readFileSync(join(dir, "backtest-report.json"), "utf8")) as BacktestBundle;
    const markdown = readFileSync(join(dir, "backtest-report.md"), "utf8");
    expect(saved.scenarios).toHaveLength(Object.keys(SCENARIOS).length);
    expect(epoch(saved)?.feeEarned).toBe("109000000");
    expect(markdown).toContain("epoch-repay");
    expect(markdown).toContain("synthetic");
    expect(markdown).toContain(epoch(saved)?.feeEarned ?? "");

    const dry = mkdtempSync(join(tmpdir(), "lockgate-backtest-"));
    const described = await run(["backtest", "--scenario", "epoch-repay", "--dry-run", "--report", dry]) as {
      sent: boolean;
    };
    expect(described.sent).toBe(false);
    expect(readdirSync(dry)).toEqual([]);

    const blocked = join(dir, "not-a-dir");
    writeFileSync(blocked, "x");
    expect(() => writeBacktestReport(blocked, saved)).toThrow(EngineError);
    try {
      writeBacktestReport(blocked, saved);
    } catch (err) {
      expect(err).toMatchObject({ code: "internal" });
    }
  });
});
