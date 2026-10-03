import { Select } from "../ui/Select";
import { SettlementWaterfall } from "../ui/SettlementWaterfall";
import { useState } from "react";
import { Search, ArrowUpRight } from "lucide-react";
import type { Platform } from "../chain/model";
import { useApp } from "../ui/context";
import { PageHead, Panel, Badge, Money, date, Empty, Explorer, money } from "../ui/primitives";
import { FundingForm } from "../ui/FundingForm";
export function PlatformTable({ platforms }: { platforms: Platform[] }) {
  return platforms.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Window</th>
            <th>Credit limit</th>
            <th>Exposure</th>
            <th>Reserve</th>
            <th>Status</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {platforms.map((p) => (
            <tr key={p.address}>
              <td data-label="Platform">
                <strong>{p.name}</strong>
                <small>Credit platform</small>
              </td>
              <td data-label="Window">{date(p.nextWindow)}</td>
              <td data-label="Credit limit · USDG">
                <Money value={p.limit} />
              </td>
              <td data-label="Exposure · USDG">
                <Money value={p.exposure} />
              </td>
              <td data-label="Reserve · USDG">
                <Money value={p.reserve} />
              </td>
              <td data-label="Status">
                <Badge tone={p.gated || p.nextWindow <= BigInt(Math.floor(Date.now() / 1000)) ? "warn" : "good"}>
                  {p.gated ? "Gated" : p.nextWindow <= BigInt(Math.floor(Date.now() / 1000)) ? "Window due" : "Open"}
                </Badge>
              </td>
              <td data-label="Actions">
                <a className="button secondary" href={`#/platform/${p.address}`}>
                  View <ArrowUpRight size={13} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No platforms found">Try a different search or refresh the chain data.</Empty>
  );
}
export default function Platforms() {
  const { snapshot } = useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const platforms = (snapshot?.platforms || []).filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) && (status === "all" || (status === "gated" ? p.gated : !p.gated)),
  );
  return (
    <div className="stack">
      <PageHead
        eyebrow="PLATFORMS"
        title="A route to liquidity."
        description="Explore platform terms, reserves, and upcoming windows. Eligibility and exit capacity are checked by each contract."
        action={
          <a href="#/onboarding" className="button secondary">
            Onboard a platform <ArrowUpRight size={14} />
          </a>
        }
      />
      <Panel>
        <div className="filter-bar">
          <label className="search-field">
            <Search size={15} />
            <input
              placeholder="Search platforms"
              aria-label="Search platforms"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Select
            label="Platform status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "open", label: "Not gated" },
              { value: "gated", label: "Gated" },
            ]}
          />
          <span className="text-small muted">
            {platforms.length} platform{platforms.length === 1 ? "" : "s"}
          </span>
        </div>
        <PlatformTable platforms={platforms} />
      </Panel>
      <div className="notice">
        These are deployed platforms, not customer integrations. Credit limits and reserve balances are live contract reads.
      </div>
    </div>
  );
}
export function PlatformDetail({ address }: { address: string }) {
  const { snapshot, review, account, connect, preview } = useApp();
  const [tab, setTab] = useState("Overview");
  const p = snapshot?.platforms.find((p) => p.address.toLowerCase() === address.toLowerCase());
  if (!p)
    return (
      <Empty title="Platform unavailable">
        This address is not in the registered platform snapshot.{" "}
        <a href="#/platforms" className="inline-link">
          Return to platforms
        </a>
      </Empty>
    );
  const due = p.nextWindow <= BigInt(Math.floor(Date.now() / 1000));
  return (
    <div className="stack">
      <PageHead
        eyebrow="PLATFORM"
        title={p.name}
        description="A deployed weekly credit platform. Every balance and action follows the current contract."
        action={
          <a className="button" href={`#/exit/${p.address}`}>
            Get an exit quote <ArrowUpRight size={14} />
          </a>
        }
      />
      <div className="row between">
        <Explorer address={p.address} />
        <Badge tone={p.gated ? "warn" : "good"}>{p.gated ? "Gated" : "Not gated"}</Badge>
      </div>
      <div>
        <div className="tabs">
          {["Overview", "Redemption queue", "Facility terms", "Activity"].map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === "Overview" && (
          <div className="grid-two">
            <Panel title="Settlement preview" eyebrow="REPAID FIRST">
              <SettlementWaterfall platform={p} />
              <button
                className="button secondary"
                disabled={!due || preview}
                onClick={() =>
                  account
                    ? review(
                        { kind: "processWindow", platform: p.address },
                        "Process settlement window",
                        "Anyone can call settlement after the window opens. The platform repays Lockgate before paying queued investors. Insufficient cash can leave the window unsettled.",
                      )
                    : connect()
                }
              >
                {preview
                  ? "Unavailable in preview"
                  : !due
                    ? "Window not open"
                    : account
                      ? "Process window"
                      : "Connect to process window"}
              </button>
            </Panel>
            <Panel title="Your position">
              <dl className="key-values">
                <div>
                  <dt>Available shares</dt>
                  <dd>{money(p.holding, 18)}</dd>
                </div>
                <div>
                  <dt>Current NAV per share</dt>
                  <dd>{money(p.nav)} USDG</dd>
                </div>
                <div>
                  <dt>Position NAV</dt>
                  <dd>{money((p.holding * p.nav) / 10n ** 18n)} USDG</dd>
                </div>
                <div>
                  <dt>Next window</dt>
                  <dd>{date(p.nextWindow)}</dd>
                </div>
              </dl>
              <FundingForm
                kind="deposit"
                platform={p.address}
                title="Fund a position"
                description="Deposit USDG into the platform and receive shares. Funding a position is separate from an early exit."
              />
            </Panel>
          </div>
        )}
        {tab === "Redemption queue" && (
          <Panel title="Redemption queue">
            <dl className="key-values">
              <div>
                <dt>Open requests</dt>
                <dd>{String(p.queueLength)}</dd>
              </div>
              <div>
                <dt>Total queued NAV</dt>
                <dd>{money(p.queuedValue)} USDG</dd>
              </div>
              <div>
                <dt>Payable with current cash</dt>
                <dd>{money(p.settlement.queuePayable)} USDG</dd>
              </div>
            </dl>
            <p className="text-small muted">
              Your requests appear in My positions & exits. Full participant history requires an indexed event feed.
            </p>
            <a className="button secondary" href="#/positions">
              Your requests
            </a>
          </Panel>
        )}
        {tab === "Facility terms" && (
          <Panel title="Platform credit line">
            <dl className="key-values">
              <div>
                <dt>Credit limit</dt>
                <dd>{money(p.limit)} USDG</dd>
              </div>
              <div>
                <dt>Exposure</dt>
                <dd>{money(p.exposure)} USDG</dd>
              </div>
              <div>
                <dt>Available reserve</dt>
                <dd>{money(p.reserve)} USDG</dd>
              </div>
              <div>
                <dt>Redemption cycle</dt>
                <dd>{String(p.windowInterval)} seconds</dd>
              </div>
              <div>
                <dt>Issuer</dt>
                <dd>
                  <Explorer address={p.issuer} />
                </dd>
              </div>
            </dl>
            <div className="notice">
              Reserve recovery is limited to available funds. Settlement ordering here is implemented by the platform contract;
              real platforms require their own integration and agreements.
            </div>
          </Panel>
        )}
        {tab === "Activity" && (
          <Panel title="Platform advances">
            {snapshot!.creditLine.advances
              .filter((a) => a.source.toLowerCase() === p.address.toLowerCase())
              .map((a) => (
                <a className="activity-row" href={`#/advance/${a.id}`} key={String(a.id)}>
                  <span>Advance #{String(a.id)}</span>
                  <span>{money(a.principal)} USDG</span>
                  <Badge tone={a.status === "Late" ? "warn" : a.status === "Repaid" ? "good" : "muted"}>{a.status}</Badge>
                </a>
              ))}
          </Panel>
        )}
      </div>
    </div>
  );
}
