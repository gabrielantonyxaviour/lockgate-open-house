import { canDraw, draw, depositEquity, emptyLine } from "./books.js";
import { mandateReject, type Mandate } from "./mandate.js";
import { repayFirstBroken } from "./window.js";

/**
 * Contract-shaped attacks. Records match PartnerRouter: one quoteId can have
 * many vaults, and relayRepay pays the index the caller passes.
 * Amounts are micro-USDG, the same units as the Foundry reproduction.
 */

export type ActorKind = "griefing" | "front-run" | "mandate";

export type ActorReport = {
  id: string;
  kind: ActorKind;
  broke: boolean;
  invariant: string;
  steps: string[];
};

type Record = {
  vault: string;
  quoteId: string;
  nav: number;
  fee: number;
  open: boolean;
};

const HONEST_NAV = 1_000_000_000;
const HONEST_FEE = 10_000_000;
const GRIEF_NAV = 100_000_000;
const GRIEF_FEE = 1_000_000;

function fund(book: Map<string, Record[]>, row: Omit<Record, "open">): void {
  const list = book.get(row.quoteId) ?? [];
  list.push({ ...row, open: true });
  book.set(row.quoteId, list);
}

function relayRepay(book: Map<string, Record[]>, quoteId: string, index: number): { ok: true; vault: string; paid: number } | { ok: false } {
  const row = book.get(quoteId)?.[index];
  if (!row?.open) return { ok: false };
  row.open = false;
  return { ok: true, vault: row.vault, paid: row.nav };
}

function openVaults(book: Map<string, Record[]>, quoteId: string): string[] {
  return (book.get(quoteId) ?? []).filter((row) => row.open).map((row) => row.vault);
}

/** A smaller funding lands at index 0. One repay clears that record only. */
export function frontRunRepayment(): ActorReport {
  const book = new Map<string, Record[]>();
  const quoteId = "same-exit";
  fund(book, { vault: "grief", quoteId, nav: GRIEF_NAV, fee: GRIEF_FEE });
  fund(book, { vault: "honest", quoteId, nav: HONEST_NAV, fee: HONEST_FEE });
  const first = relayRepay(book, quoteId, 0);
  const second = relayRepay(book, quoteId, 0);
  const stillOpen = openVaults(book, quoteId);
  const paidGrief = first.ok && first.vault === "grief" && first.paid === GRIEF_NAV;
  const honestLeftOpen = stillOpen.includes("honest") && !second.ok;
  return {
    id: "front-run-repay",
    kind: "front-run",
    broke: paidGrief && honestLeftOpen,
    invariant: "one relayRepay clears every vault that funded the quoteId",
    steps: [
      `grief vault funds ${GRIEF_NAV} owed first, so it is record 0`,
      `honest vault funds ${HONEST_NAV} owed as record 1`,
      `relayRepay(index 0) pays ${first.ok ? first.paid : 0} to ${first.ok ? first.vault : "nobody"}`,
      `a second relayRepay of index 0 is ${second.ok ? "accepted" : "empty"}`,
      `still open: ${stillOpen.join(", ") || "none"}`,
    ],
  };
}

/** Shared idle. The first advance takes the cash. The next platform cannot be paid with it. */
export function griefSharedIdle(): ActorReport {
  const line = emptyLine();
  depositEquity(line, 10_000);
  const first = canDraw(line, "attacker", 9_900, 10_000, 0, 10_000);
  if (first.ok) draw(line, "attacker", 9_900, 10_000);
  const victim = canDraw(line, "victim", 200, 250, 0, 10_000);
  const again = canDraw(line, "attacker", 1, 1, 0, 10_000);
  return {
    id: "grief-idle",
    kind: "griefing",
    broke: !first.ok || victim.ok || again.ok,
    invariant: "a later platform cannot be paid with cash an earlier advance already took",
    steps: [
      `attacker draw of 9900 principal is ${first.ok ? "accepted" : first.reason}`,
      `idle left ${line.balance - line.reserve}`,
      `victim principal 200 is ${victim.ok ? "accepted" : victim.reason}`,
      `attacker one more unit is ${again.ok ? "accepted" : again.reason}`,
    ],
  };
}

/** Proposer-only and out-of-mandate attempts. Cash is not a step in this check. */
export function mandateAbuse(): ActorReport {
  const line = emptyLine();
  depositEquity(line, 10_000_000_000);
  const mandate: Mandate = {
    platforms: new Set(["harbour"]),
    limit: 5_000_000_000,
    minFeeBps: 25,
    maxTenorSeconds: 86_400,
    concentrationBps: 10_000,
    expiryDay: 10,
    paused: false,
  };
  const stranger = mandateReject(line, mandate, input("stranger", 1_000_000));
  const cheap = mandateReject(line, mandate, { ...input("harbour", 1_000_000_000), feeBps: 24 });
  const late = mandateReject(line, mandate, { ...input("harbour", 1_000_000), tenorSeconds: 86_401 });
  const investorsFirst = repayFirstBroken(true, 1_000_000);
  const refused = repayFirstBroken(true, 0);
  return {
    id: "mandate-abuse",
    kind: "mandate",
    broke: stranger !== "mandate-platform" || cheap !== "mandate-fee" || late !== "mandate-tenor" || !investorsFirst || refused,
    invariant: "an unapproved platform, a fee under the floor, or a late tenor moves no advance",
    steps: [
      `stranger platform is ${stranger}`,
      `24 bps on an approved platform is ${cheap}`,
      `tenor one second over the max is ${late}`,
      `paying investors while an advance is open is ${investorsFirst ? "a breach" : "allowed"}`,
      `holding that payment back is ${refused ? "a breach" : "within the rule"}`,
    ],
  };
}

export function runActors(): ActorReport[] {
  return [frontRunRepayment(), griefSharedIdle(), mandateAbuse()];
}

export function renderAdversarial(reports: readonly ActorReport[] = runActors()): string {
  const breaks = reports.filter((report) => report.broke);
  const lines = [
    "# SUMMARY",
    "",
    `Adversarial actors against the current router and mandate shape. ${reports.length} attacks. ${breaks.length} broke the invariant it names. This is not a pentest and not a legal opinion. No contract source was changed.`,
    "",
    "The front-run is the same shape as `contracts/test/invariant/Adversarial.t.sol`: two vaults fund one quoteId, and `relayRepay` of index 0 leaves the other vault open. Taking the shared idle, and a mandate abuse, do not pay an advance the rails refuse.",
    "",
    "| Id | Kind | Broke | Invariant |",
    "|---|---|---|---|",
    ...reports.map((report) => `| ${report.id} | ${report.kind} | ${report.broke ? "yes" : "no"} | ${report.invariant} |`),
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.id}`, "");
    for (const step of report.steps) lines.push(`- ${step}`);
    lines.push("");
  }
  return lines.join("\n");
}

function input(platform: string, owed: number) {
  return {
    platform,
    day: 1,
    feeBps: 100,
    tenorSeconds: 600,
    principal: Math.max(0, owed - 1),
    owed,
  };
}
