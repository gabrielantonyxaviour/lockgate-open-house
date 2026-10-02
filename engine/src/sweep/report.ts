import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alertsForSweep, type Alert } from "../alert/evaluate.js";
import { parseOrThrow } from "../domain.js";
import { EngineError } from "../errors.js";
import { encodeJson } from "../json.js";
import { logEvent, redactValue } from "../log.js";
import { planSweep, sweepInputSchema, type SweepAction } from "./sweep.js";

let sequence = 0;

export function sweepReportName(chainId: number, now: number, stamp = Date.now()): string {
  sequence += 1;
  return `sweep-${chainId}-${now}-${stamp}-${sequence}.json`;
}

function alertsForBook(raw: unknown, actions: SweepAction[]): Alert[] {
  const body = parseOrThrow(sweepInputSchema, raw);
  return body.advances.flatMap((advance, index) => {
    const action = actions[index];
    return action ? alertsForSweep(advance.platform, [action]) : [];
  });
}

export function buildSweepReport(raw: unknown, actions: SweepAction[]) {
  const body = parseOrThrow(sweepInputSchema, raw);
  const counts = { repay: 0, "mark-late": 0, "wait-for-cash": 0, pending: 0, skip: 0 };
  for (const action of actions) counts[action.kind] += 1;
  const alerts = alertsForBook(raw, actions);
  return {
    kind: "sweep" as const,
    chainId: body.chainId,
    now: body.now,
    graceSeconds: body.graceSeconds,
    counts,
    sendable: actions.filter((action) => action.sendable).length,
    alerts,
    actions,
  };
}

/** One JSON file per sweep. The plan stays on stdout. This file adds the counts. */
export function writeSweepReport(dir: string, raw: unknown, actions: SweepAction[]): string {
  const report = buildSweepReport(raw, actions);
  const path = join(dir, sweepReportName(report.chainId, report.now));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${encodeJson(redactValue(report))}\n`);
  } catch {
    throw new EngineError("internal", "could not write the sweep report");
  }
  return path;
}

export function runSweep(raw: unknown, reportDir: string): SweepAction[] {
  const actions = planSweep(raw);
  const path = writeSweepReport(reportDir, raw, actions);
  const report = buildSweepReport(raw, actions);
  logEvent("info", "sweep", {
    chainId: report.chainId,
    now: report.now,
    actions: actions.length,
    sendable: report.sendable,
    report: path,
  });
  const waiting = report.counts["wait-for-cash"];
  if (waiting > 0) logEvent("warn", "sweep", { waiting });
  const critical = report.alerts.filter((alert) => alert.severity === "critical").length;
  if (critical > 0) logEvent("error", "sweep", { critical });
  return actions;
}
