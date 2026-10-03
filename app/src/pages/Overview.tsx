import { ArrowRight, ArrowUpRight, Layers, Clock3 } from "lucide-react";
import { useApp } from "../ui/context";
import { Panel, PageHead, Metric, Money, money, Badge, date, Empty } from "../ui/primitives";
import { UsdgMark } from "../ui/Brand";
import { PlatformTable } from "./Platforms";
import { AdvanceTable } from "./Activity";
export default function Overview() {
  const { snapshot, account, connect, preview } = useApp();
  if (!snapshot)
    return <Empty title="Reading the exit desk">Live balances and platform terms will appear once the chain responds.</Empty>;
  const line = snapshot.creditLine;
  const all = line.capital + line.outstanding;
  const share = all > 0n ? Number((line.capital * 10000n) / all) / 100 : 0;
  const due = snapshot.platforms.filter((p) => p.nextWindow <= BigInt(Math.floor(Date.now() / 1000)));
  return (
    <div className="stack">
      <PageHead
        eyebrow="THE LOCKGATE EXIT DESK"
        title="Capital in motion."
        description="An early exit for investors. A credit line to the platform. Repaid first at the next settlement window."
        action={
          <a className="button" href="#/platforms">
            Explore platforms <ArrowUpRight size={15} />
          </a>
        }
      />
      <section className="overview-hero">
        <div className="hero-main">
          <span className="eyebrow">OWN-BOOK LIQUIDITY</span>
          <div className="hero-number">
            {money(line.capital)}
            <span className="brand-asset">
              <UsdgMark decorative /> USDG
            </span>
          </div>
          <div className="hero-caption">
            <Badge tone={line.paused ? "warn" : "good"}>{line.paused ? "Facility paused" : "Capital on hand"}</Badge>
            <span>Exit availability also depends on platform terms.</span>
          </div>
          <div className="hero-actions">
            <a className="button" href="#/positions">
              Your positions <ArrowRight size={14} />
            </a>
            {!account && !preview && (
              <button className="button secondary" onClick={connect}>
                Connect wallet
              </button>
            )}
          </div>
        </div>
        <div className="hero-side">
          <span className="eyebrow">THE EXIT CYCLE</span>
          <div className="cycle-row">
            <span>01</span>
            <div>
              <strong>Investor exits today</strong>
              <p>Receive USDG, less the quoted fee.</p>
            </div>
          </div>
          <div className="cycle-row">
            <span>02</span>
            <div>
              <strong>Platform draws liquidity</strong>
              <p>The loan is to the credit platform.</p>
            </div>
          </div>
          <div className="cycle-row">
            <span>03</span>
            <div>
              <strong>Lockgate is repaid first</strong>
              <p>Before the remaining redemption queue.</p>
            </div>
          </div>
        </div>
      </section>
      <div className="metrics">
        <Metric label="Outstanding principal" value={money(line.outstanding)} caption="USDG advanced and still outstanding" />
        <Metric
          label="Utilization"
          value={`${(line.utilizationBps / 100).toFixed(2)}%`}
          caption="From the deployed credit line"
        />
        <Metric
          label="Earned fees"
          value={money(line.earnedFees)}
          caption="Contract accounting · not necessarily withdrawn cash"
        />
        <Metric label="Registered platforms" value={String(snapshot.platforms.length)} caption="Platforms on Arbitrum Sepolia" />
      </div>
      <div className="grid-two">
        <Panel title="Where capital sits" eyebrow="CAPITAL ALLOCATION">
          <div className="allocation-heading">
            <strong>
              {money(all)} <span>USDG</span>
            </strong>
            <span>Total idle + principal</span>
          </div>
          <div className="allocation-bar" aria-label={`${share.toFixed(1)} percent idle capital`}>
            <span style={{ width: `${share}%` }} />
            <i />
          </div>
          <div className="allocation-legend">
            <div>
              <i className="legend-dot" />
              <span>Idle liquidity</span>
              <strong>{money(line.capital)}</strong>
            </div>
            <div>
              <i className="legend-dot faint" />
              <span>Outstanding principal</span>
              <strong>{money(line.outstanding)}</strong>
            </div>
          </div>
          <p className="text-small muted">Capital held idle and principal deployed into platform advances.</p>
        </Panel>
        <Panel title="Next settlement" eyebrow="PLATFORM WINDOWS">
          {snapshot.platforms[0] ? (
            <div className="stack">
              <div className="row between">
                <span className="text-small">{snapshot.platforms[0].name}</span>
                <Badge tone={due.length ? "warn" : "muted"}>{due.length ? "Window due" : "Upcoming"}</Badge>
              </div>
              <div className="window-time">
                <Clock3 size={19} />
                <strong>{date(snapshot.platforms[0].nextWindow)}</strong>
              </div>
              <dl className="key-values">
                <div>
                  <dt>Platform cash</dt>
                  <dd>
                    <Money value={snapshot.platforms[0].cash} /> USDG
                  </dd>
                </div>
                <div>
                  <dt>Lockgate repayment first</dt>
                  <dd>
                    <Money value={snapshot.platforms[0].settlement.repayFirst} /> USDG
                  </dd>
                </div>
                <div>
                  <dt>Queue shortfall</dt>
                  <dd>
                    <Money value={snapshot.platforms[0].settlement.queueShortfall} /> USDG
                  </dd>
                </div>
              </dl>
              <a className="inline-link text-small" href={`#/platform/${snapshot.platforms[0].address}`}>
                Inspect settlement <ArrowRight size={13} />
              </a>
            </div>
          ) : (
            <Empty title="No settlement scheduled">A registered platform will appear here.</Empty>
          )}
        </Panel>
      </div>
      <Panel title="Platforms" eyebrow="AVAILABLE ROUTES">
        <PlatformTable platforms={snapshot.platforms} />
      </Panel>
      <Panel title="Recent advances" eyebrow="ON-CHAIN LEDGER">
        <AdvanceTable advances={line.advances.slice(-5).reverse()} />
      </Panel>
      <div className="row between overview-note">
        <div className="row">
          <Layers size={15} />
          <span>Partner capital remains in each partner’s own vault.</span>
        </div>
        <a href="#/capital" className="inline-link">
          View partner vaults <ArrowRight size={12} />
        </a>
      </div>
    </div>
  );
}
