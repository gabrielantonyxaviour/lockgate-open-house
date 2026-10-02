import type { Command } from "./cli-check.js";
import { EngineError } from "./errors.js";

let dry = false;

export function enterDryRun(): void {
  dry = true;
}

export function leaveDryRun(): void {
  dry = false;
}

export function isDryRun(): boolean {
  return dry;
}

/** Library send paths call this before they touch a sender. */
export function blockSendDuringDryRun(what: string): void {
  if (dry) throw new EngineError("refused", `dry-run refuses to send ${what}`);
}

export type IntendedAction = {
  kind: string;
  send: false;
  to: string | null;
  data: string | null;
  summary: Record<string, string | number | boolean | null>;
};

export type DryRunResult = {
  dryRun: true;
  command: Command;
  sent: false;
  actions: IntendedAction[];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function action(
  kind: string,
  summary: Record<string, string | number | boolean | null>,
  to: string | null = null,
  data: string | null = null,
): IntendedAction {
  return { kind, send: false, to, data, summary };
}

function quoteAction(value: unknown): IntendedAction {
  const row = record(value);
  return action("quote", {
    available: row?.available === true,
    feeBps: typeof row?.feeBps === "number" ? row.feeBps : null,
    fee: text(row?.fee),
    payout: text(row?.payout),
  });
}

/** Describe the result of one command as actions that were not sent. */
export function describeDryRun(command: Command, result: unknown): DryRunResult {
  return { dryRun: true, command, sent: false, actions: actionsFor(command, result) };
}

function actionsFor(command: Command, result: unknown): IntendedAction[] {
  if (command === "quote") return [quoteAction(result)];
  if (command === "score") {
    const row = record(result);
    return [action("score", { bps: typeof row?.bps === "number" ? row.bps : null })];
  }
  if (command === "alerts") {
    return [action("alerts", { count: Array.isArray(result) ? result.length : 0 })];
  }
  if (command === "example") {
    const row = record(result);
    const input = record(row?.input);
    return [action("example", { kind: text(input?.kind) })];
  }
  if (command === "propose") return [proposalAction(result)];
  if (command === "sweep") return sweepActions(result);
  if (command === "facility") return [facilityAction(result)];
  if (command === "backtest") return [backtestAction(result)];
  if (command === "cre-tick") return creActions(result);
  if (command === "cre-sweep") return creSweepActions(result);
  if (command === "check") return checkActions(result);
  throw new EngineError("invariant", "dry-run could not describe the command");
}

function proposalAction(result: unknown): IntendedAction {
  const row = record(result);
  const domain = record(row?.domain);
  return action("submitProposal", {
    submittable: row?.submittable === true,
    digest: text(row?.digest),
    signature: null,
  }, text(domain?.verifyingContract), text(row?.calldata));
}

function sweepActions(result: unknown): IntendedAction[] {
  if (!Array.isArray(result)) return [];
  return result.map((item) => {
    const row = record(item);
    return action(text(row?.kind) ?? "sweep", {
      advanceId: text(row?.advanceId),
      wouldSend: row?.sendable === true,
    }, text(row?.vault), text(row?.calldata));
  });
}

function facilityAction(result: unknown): IntendedAction {
  const row = record(result);
  return action("facility", {
    solvent: row?.solvent === true,
    canFund: row?.canFund === true,
    availableDraw: text(row?.availableDraw),
    wouldDraw: false,
  });
}

function backtestAction(result: unknown): IntendedAction {
  const row = record(result);
  return action("backtest", {
    feeEarned: text(row?.feeEarned),
    loss: text(row?.loss),
    refused: typeof row?.refused === "number" ? row.refused : null,
  });
}

function checkActions(result: unknown): IntendedAction[] {
  const row = record(result);
  const findings = Array.isArray(row?.findings) ? row.findings : [];
  const failed = findings.filter((item) => record(item)?.ok === false).length;
  return [action("check", { ok: row?.ok === true, findings: findings.length, failed })];
}

function creSweepActions(result: unknown): IntendedAction[] {
  const row = record(result);
  const actions = Array.isArray(row?.actions) ? row.actions : [];
  return [
    action("cre-sweep", {
      onReportCalled: row?.onReportCalled === true,
      broadcast: row?.broadcast === true,
      chainId: typeof row?.chainId === "number" ? row.chainId : null,
    }),
    ...actions.map((item) => {
      const planned = record(item);
      return action(text(planned?.kind) ?? "sweep", {
        advanceId: text(planned?.advanceId),
        wouldSend: planned?.sendable === true,
      }, text(planned?.vault), text(planned?.calldata));
    }),
  ];
}

function creActions(result: unknown): IntendedAction[] {
  const row = record(result);
  const proposals = Array.isArray(row?.proposals) ? row.proposals : [];
  const skipped = Array.isArray(row?.skipped) ? row.skipped : [];
  const filed = proposals.map((item) => {
    const proposal = record(item);
    const domain = record(proposal?.domain);
    const quote = record(proposal?.quote);
    return action("submitProposal", {
      submittable: proposal?.submittable === true,
      platformId: text(quote?.platformId),
    }, text(domain?.verifyingContract), text(proposal?.calldata));
  });
  const skips = skipped.map((item) => {
    const skip = record(item);
    return action("skip", { platformId: text(skip?.platformId), code: text(skip?.code) });
  });
  return [...filed, ...skips];
}
