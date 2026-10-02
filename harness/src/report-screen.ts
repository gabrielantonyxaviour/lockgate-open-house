const MAX_LINES = 40;

export type ReportContract = { name: string; address: string; code: boolean };
export type ReportMandate = { vault: string; text: string };
export type ReportEvent = { block: string; contract: string; name: string; args: string };
export type StateReport = {
  chainId: number;
  block: string;
  mode: string;
  endpoint: string;
  contracts: ReportContract[];
  balances: string[];
  line: string;
  mandates: ReportMandate[];
  events: ReportEvent[];
};

/** Named event fields only. A 32-byte hex value is left out. */
export function formatEventArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (/^\d+$/.test(key)) continue;
    const shown = showValue(value);
    if (shown !== null) parts.push(`${key} ${shown}`);
  }
  const text = parts.join(" ");
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

/** At most 40 lines. Extra events go first, then extra contracts. */
export function renderReport(report: StateReport): string {
  let events = report.events.length;
  let contracts = report.contracts.length;
  let lines = assemble(report, contracts, events);
  while (lines.length > MAX_LINES && events > 0) {
    events -= 1;
    lines = assemble(report, contracts, events);
  }
  while (lines.length > MAX_LINES && contracts > 0) {
    contracts -= 1;
    lines = assemble(report, contracts, 0);
  }
  return lines.slice(0, MAX_LINES).join("\n");
}

export function endpointOf(rpc: string): string {
  try {
    const url = new URL(rpc);
    return `${url.hostname}:${url.port}`;
  } catch {
    return "";
  }
}

export function tenorOf(seconds: bigint): string {
  if (seconds > 0n && seconds % 86_400n === 0n) return `${seconds / 86_400n}d`;
  return seconds.toString();
}

function assemble(report: StateReport, contractCount: number, eventCount: number): string[] {
  const hidden = report.contracts.length - contractCount;
  const contractLines = report.contracts.slice(0, contractCount).map((item) => (
    `  ${item.name.padEnd(22)} ${item.address}${item.code ? "" : "  no code"}`
  ));
  if (hidden > 0) contractLines.push(`  +${hidden} more`);
  const shown = report.events.slice(-eventCount);
  const eventLines = shown.length === 0
    ? ["  none"]
    : shown.map((item) => `  ${item.block}  ${item.contract}  ${item.name}${item.args ? `  ${item.args}` : ""}`);
  const eventLabel = eventCount < report.events.length
    ? `Events ${eventCount} of ${report.events.length}`
    : `Events ${report.events.length}`;
  const mandates = report.mandates.length === 0
    ? ["  no vaults"]
    : report.mandates.map((item) => `  ${item.vault}  ${item.text}`);
  return [
    `Lockgate  chain ${report.chainId}  block ${report.block}  ${report.mode}  ${report.endpoint}`,
    `Contracts ${report.contracts.length}`,
    ...contractLines,
    "Balances",
    ...report.balances.map((line) => `  ${line}`),
    `  ${report.line}`,
    "Mandates",
    ...mandates,
    eventLabel,
    ...eventLines,
  ];
}

function showValue(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value;
  if (typeof value === "string" && value.length > 0 && !value.startsWith("0x")) return value;
  return null;
}
