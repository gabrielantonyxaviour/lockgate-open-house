export function usd(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(micro));
  const whole = Math.floor(abs / 1_000_000);
  const cents = Math.floor((abs % 1_000_000) / 10_000);
  const body = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${body}.${String(cents).padStart(2, "0")}`;
}

export function pctFromBps(bps: number): string {
  const sign = bps < 0 ? "-" : "";
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}%`;
}

/** Nearest rank. The rank is ceil(p/100 * n), 1-based, then clamped into the sorted list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index]!;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function sum(values: readonly number[]): number {
  return values.reduce((n, v) => n + v, 0);
}
