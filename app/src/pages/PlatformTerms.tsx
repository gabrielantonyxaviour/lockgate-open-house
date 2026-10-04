import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { useApp } from "../ui/context";
import { Badge, Empty, Explorer, PageHead, Panel, date, money } from "../ui/primitives";

export default function PlatformTerms({ address, origin }: { address?: string; origin: string | null }) {
  const { snapshot, loading, error, refresh, preview } = useApp();
  const role = origin === "issuer" ? "issuer" : "investor";
  const listHref = `#/terms?from=${role}`;
  const platform = snapshot?.platforms.find((item) => item.address.toLowerCase() === address?.toLowerCase());
  const retry = <button className="button secondary" disabled={loading} onClick={() => void refresh()}>
    <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh platform terms
  </button>;
  return (
    <div className="terms-content stack">
      <a className="inline-link entry-back" href={address ? listHref : `#/start/${role}`}>
        <ArrowLeft size={14} /> {address ? "All platform terms" : `Back to ${role} journey`}
      </a>
      <PageHead eyebrow="PLATFORM TERMS" title={platform?.name || (address ? "Platform details" : "Explore platform terms.")}
        description="Read current facility and settlement terms before connecting a wallet or choosing an exit."
        action={<Badge>Read only</Badge>} />
      <div className="terms-source row between">
        <span className="text-small muted">{preview ? "Illustrative preview records" : snapshot ? `Arbitrum Sepolia · Block ${snapshot.blockNumber}` : "Arbitrum Sepolia"}
          {loading ? " · Updating…" : snapshot && !preview ? ` · Read ${new Date(snapshot.observedAt).toLocaleTimeString()}` : ""}
        </span>
        {retry}
      </div>
      {error && <div className="notice error" role="alert">Platform terms could not be refreshed. {snapshot ? "The last loaded records remain visible." : "Try refreshing to load the records."}</div>}
      {(!snapshot || (address && !platform)) && loading ? (
        <div className="loading-state" role="status"><h2>Reading platform terms…</h2><p>Fetching facility balances and settlement terms.</p></div>
      ) : !snapshot ? (
        <Empty title="Platform terms unavailable">Refresh to try the chain read again.</Empty>
      ) : address && !platform ? (
        <Empty title="Platform not found">This address is not in the loaded platform registry. Refresh or return to all platform terms.</Empty>
      ) : platform ? (
        <>
          <div className="row between terms-identity"><Explorer address={platform.address} /><Badge tone={platform.gated ? "warn" : "good"}>{platform.gated ? "Redemptions paused" : "Redemptions open"}</Badge></div>
          <div className="grid-two">
            <Panel title="Settlement terms">
              <dl className="key-values">
                <div><dt>NAV per share</dt><dd>{money(platform.nav)} USDG</dd></div>
                <div><dt>Next settlement window</dt><dd>{date(platform.nextWindow)}</dd></div>
                <div><dt>Window interval</dt><dd>{String(platform.windowInterval)} seconds</dd></div>
                <div><dt>Settlement cash</dt><dd>{money(platform.cash)} USDG</dd></div>
                <div><dt>Queued redemptions</dt><dd>{money(platform.queuedValue)} USDG</dd></div>
              </dl>
              <p className="text-small muted">At settlement, Lockgate is repaid before the remaining investor queue. Timing depends on available cash.</p>
            </Panel>
            <Panel title="Credit facility">
              <dl className="key-values">
                <div><dt>Facility limit</dt><dd>{money(platform.limit)} USDG</dd></div>
                <div><dt>Current exposure</dt><dd>{money(platform.exposure)} USDG</dd></div>
                <div><dt>Posted reserve</dt><dd>{money(platform.reserve)} USDG</dd></div>
                {platform.reserveBps !== undefined && <div><dt>Required reserve ratio</dt><dd>{platform.reserveBps / 100}%</dd></div>}
                {platform.riskBps !== undefined && <div><dt>Risk premium</dt><dd>{platform.riskBps / 100}%</dd></div>}
              </dl>
              <p className="text-small muted">Reserve protection is limited to available funds. Exit fees and availability are shown in a live quote for your position.</p>
            </Panel>
          </div>
        </>
      ) : snapshot.platforms.length ? (
        <div className="terms-platforms">
          {snapshot.platforms.map((item) => <a className="terms-platform" key={item.address} href={`#/terms/${item.address}?from=${role}`}>
            <div className="row between"><h2>{item.name}</h2><ArrowRight size={17} /></div>
            <Badge tone={item.gated ? "warn" : "good"}>{item.gated ? "Redemptions paused" : "Redemptions open"}</Badge>
            <dl className="key-values"><div><dt>Facility limit</dt><dd>{money(item.limit)} USDG</dd></div><div><dt>Next settlement</dt><dd>{date(item.nextWindow)}</dd></div></dl>
            <span className="inline-link">View platform terms <ArrowRight size={13} /></span>
          </a>)}
        </div>
      ) : <Empty title="No platforms registered">Refresh to check for newly registered platforms, or return to your journey.</Empty>}
      {address && <a className="inline-link" href={`#/start/${role}`}>Back to {role} journey <ArrowRight size={13} /></a>}
    </div>
  );
}
