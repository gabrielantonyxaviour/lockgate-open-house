import { useState } from "react";
import { ArrowRight, ArrowUpRight, RefreshCw, Wallet } from "lucide-react";
import { useApp } from "../ui/context";
import { Badge, Money, date, short } from "../ui/primitives";
import { UsdgMark } from "../ui/Brand";
import "../ui/public-home.css";

export default function PublicHome() {
  const { snapshot, account, loading, error, connect, refresh } = useApp();
  const [connecting, setConnecting] = useState(false);
  const line = snapshot?.creditLine;
  const total = line ? line.capital + line.outstanding : 0n;
  const idleShare = line && total > 0n ? Number((line.capital * 10000n) / total) / 100 : 0;
  const queued = snapshot?.platforms.reduce((sum, platform) => sum + platform.queuedValue, 0n);
  const observedAt = snapshot ? new Date(snapshot.observedAt) : null;
  const stale = snapshot ? Date.now() - snapshot.observedAt > 120_000 : false;
  const connectAccount = async () => {
    setConnecting(true);
    try {
      await connect();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="public-home">
      <section className="public-intro" aria-labelledby="public-title">
        <div className="public-intro-copy">
          <span className="eyebrow">THE EARLY EXIT RAIL</span>
          <h1 id="public-title">Your capital.<br />On your timeline.</h1>
          <p>
            Review an earlier exit from your tokenized position. Lockgate provides USDG through a platform credit line,
            repaid first when the platform settles.
          </p>
          <a className="public-text-link" href="#/platforms">
            Explore connected platforms <ArrowUpRight size={15} />
          </a>
        </div>
        <aside className="public-start" aria-labelledby="public-start-title">
          <span className="public-wallet-icon"><Wallet size={21} strokeWidth={1.5} /></span>
          <h2 id="public-start-title">{account ? "Your workspace is next." : "See what’s available to you."}</h2>
          <p>
            {account
              ? "Choose your investor or platform workspace to continue with this wallet."
              : "Connect to find your positions, review an exit quote, or access your platform’s facility."}
          </p>
          {account ? (
            <a className="button" href="#/choose">Continue to your workspace <ArrowRight size={15} /></a>
          ) : (
            <button className="button" onClick={connectAccount} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}<ArrowRight size={15} />
            </button>
          )}
          <small>{account ? `Connected as ${short(account)}` : "Connecting does not authorize a transaction."}</small>
        </aside>
      </section>

      <section className="public-network" aria-labelledby="public-network-title">
        <header className="public-section-head">
          <div>
            <span className="eyebrow">PUBLIC OVERVIEW</span>
            <h2 id="public-network-title">Inside the exit rail</h2>
          </div>
          <div className="public-read-status">
            <span>{snapshot ? `${stale ? "Last read" : "Read"} at ${observedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : loading ? "Reading chain data…" : "Awaiting chain data"}</span>
            <button className="icon-button" onClick={refresh} disabled={loading} aria-label="Refresh public data">
              <RefreshCw size={13} />
            </button>
          </div>
        </header>
        <div className="public-metrics">
          <div className="public-metric">
            <span>Liquidity on hand</span>
            <strong>{line ? <Money value={line.capital} /> : "—"}<small>USDG</small></strong>
            <p>Own-book capital held for advances</p>
          </div>
          <div className="public-metric">
            <span>Outstanding advances</span>
            <strong>{line ? <Money value={line.outstanding} /> : "—"}<small>USDG</small></strong>
            <p>Principal awaiting repayment</p>
          </div>
          <div className="public-metric">
            <span>Queued redemptions</span>
            <strong>{queued !== undefined ? <Money value={queued} /> : "—"}<small>USDG</small></strong>
            <p>Across the platforms below</p>
          </div>
          <div className="public-metric">
            <span>Connected platforms</span>
            <strong>{snapshot?.platforms.length ?? "—"}</strong>
            <p>Browse terms before connecting</p>
          </div>
        </div>
        {!snapshot && (
          <p className="public-data-note" role="status">
            {error ? "Public figures are unavailable. Retry the chain read above." : "Figures will appear after the chain responds. You can connect your wallet while they load."}
          </p>
        )}
        {snapshot && (
          <p className="public-data-note">
            Block {snapshot.blockNumber.toString()} · {stale ? "Data may be stale. Refresh before making a decision." : "On-chain balances. Exit availability depends on platform terms and your position."}
          </p>
        )}
      </section>

      <div className="public-detail-grid">
        <section className="panel public-capital" aria-labelledby="public-capital-title">
          <div className="public-card-head">
            <div><span className="eyebrow">OWN-BOOK FACILITY</span><h2 id="public-capital-title">Where the liquidity sits</h2></div>
            {line && <Badge tone={line.paused ? "warn" : "muted"}>{line.paused ? "Paused" : "Active"}</Badge>}
          </div>
          <div className="public-capital-total">
            <strong>{line ? <Money value={total} /> : "—"}</strong>
            <span><UsdgMark size={18} decorative /> USDG</span>
          </div>
          <p className="public-total-caption">Idle capital + outstanding principal</p>
          <div className={`public-allocation ${!line || total === 0n ? "public-allocation-empty" : ""}`} role="img" aria-label={!line ? "Capital allocation awaiting chain data" : total === 0n ? "No capital held or outstanding" : `${idleShare.toFixed(2)} percent idle capital; remainder outstanding principal`}>
            {line && total > 0n && <span style={{ width: `${idleShare}%` }} />}
          </div>
          <div className="public-allocation-key">
            <span><i />Idle capital <b>{line ? `${idleShare.toFixed(1)}%` : "—"}</b></span>
            <span><i />Outstanding <b>{line ? `${(total > 0n ? 100 - idleShare : 0).toFixed(1)}%` : "—"}</b></span>
          </div>
          <p className="public-card-note">A facility balance is not an exit quote. Your platform’s limits, reserve, and settlement terms determine availability.</p>
        </section>
        <section className="panel public-how" aria-labelledby="public-how-title">
          <span className="eyebrow">HOW AN EARLIER EXIT WORKS</span>
          <h2 id="public-how-title">From your position to USDG</h2>
          <ol>
            <li><span>01</span><div><h3>Review your options</h3><p>Compare the next redemption window with an earlier exit and its fee.</p></div></li>
            <li><span>02</span><div><h3>Confirm an exact quote</h3><p>Approve the payout in your wallet. The platform draws the credit.</p></div></li>
            <li><span>03</span><div><h3>The platform settles</h3><p>Available settlement cash repays the facility before the remaining redemption queue.</p></div></li>
          </ol>
        </section>
      </div>

      <section className="panel public-platforms" aria-labelledby="public-platforms-title">
        <header className="public-section-head">
          <div><span className="eyebrow">PLATFORM WINDOWS</span><h2 id="public-platforms-title">Explore the connected platforms</h2></div>
          <a className="public-text-link" href="#/platforms">View all <ArrowUpRight size={14} /></a>
        </header>
        {snapshot?.platforms.length ? (
          <div className="public-platform-list">
            <div className="public-platform-labels" aria-hidden="true"><span>Platform</span><span>Next window</span><span>Queued value</span><span /></div>
            {snapshot.platforms.slice(0, 4).map((platform) => {
              const due = platform.nextWindow > 0n && platform.nextWindow <= BigInt(Math.floor(Date.now() / 1000));
              return (
                <a className="public-platform-row" href={`#/platform/${platform.address}`} key={platform.address}>
                  <div className="public-platform-name"><strong>{platform.name}</strong><small>{platform.gated ? "Permissioned access" : "Open access"}</small></div>
                  <div className="public-platform-window"><span>{date(platform.nextWindow)}</span>{due && <Badge tone="warn">Window due</Badge>}</div>
                  <div className="public-platform-amount"><Money value={platform.queuedValue} /><small> USDG queued</small></div>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              );
            })}
          </div>
        ) : (
          <p className="public-platform-empty">{snapshot ? "No platforms are registered on this network yet." : "Platform names, redemption windows, and queue values will appear here when the chain responds."}</p>
        )}
      </section>
      <div className="public-bottom-note">
        <p>For platforms: offer earlier exits through a facility with explicit limits and repayment terms.</p>
        <a className="public-text-link" href={account ? "#/choose" : "#/integration"}>{account ? "Open your workspace" : "Explore integration"}<ArrowRight size={14} /></a>
      </div>
    </div>
  );
}
