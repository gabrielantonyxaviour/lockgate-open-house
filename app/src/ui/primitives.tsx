import type { ReactNode } from "react";
import { ArrowUpRight, ArrowRight, Check, CircleAlert, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";
export function Panel({
  title,
  eyebrow,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || eyebrow) && (
        <header className="panel-head">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          {title && <h2>{title}</h2>}
        </header>
      )}
      {children}
    </section>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow || "EXIT INFRASTRUCTURE"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <CircleAlert size={22} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  caption,
  children,
}: {
  label: string;
  value: string;
  caption?: string;
  children?: ReactNode;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
      {children}
    </div>
  );
}
export function Money({ value, decimals = 6 }: { value: bigint; decimals?: number }) {
  return <>{money(value, decimals)}</>;
}
export function money(value: bigint, decimals = 6) {
  const n = formatUnits(value, decimals);
  const [whole, fraction = ""] = n.split(".");
  return `${document.documentElement.dataset.numberStyle === "plain" ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0").replace(/0+$/, "").padEnd(2, "0")}`;
}
export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const date = (value: bigint) =>
  value === 0n
    ? "Not set"
    : new Date(Number(value) * 1000).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
export function Explorer({ address, hash, children }: { address?: string; hash?: string; children?: ReactNode }) {
  return (
    <a
      className="inline-link mono"
      href={`https://sepolia.arbiscan.io/${hash ? "tx" : "address"}/${hash || address}`}
      target="_blank"
      rel="noreferrer"
    >
      {children || short(hash || address || "")}
      <ExternalLink size={12} />
    </a>
  );
}
export function Arrow({ up = false }: { up?: boolean }) {
  return up ? <ArrowUpRight size={16} /> : <ArrowRight size={16} />;
}
export function CheckRow({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div className="check-row">
      <span className={`check-icon ${done ? "complete" : ""}`}>{done ? <Check size={13} /> : "·"}</span>
      {children}
    </div>
  );
}
