import { ArrowRight, Building2, Wallet } from "lucide-react";
import { useEffect } from "react";
import { useApp } from "../ui/context";
import { Badge, date, money, short } from "../ui/primitives";
import "../ui/entry.css";

export default function JourneyStart({ role }: { role: "investor" | "issuer" }) {
  const { snapshot, account, connect, loading, error, refresh, preview } = useApp();
  const investor = role === "investor";
  useEffect(() => {
    try {
      localStorage.setItem("lockgate.journey.v1", JSON.stringify({ version: 1, role }));
    } catch {
      /* A journey does not require browser storage. */
    }
  }, [role]);
  const currentSnapshot = snapshot?.account?.toLowerCase() === account?.toLowerCase() ? snapshot : null;
  const owned = account
    ? (currentSnapshot?.platforms.filter(
        (platform) =>
          platform.holding > 0n || platform.requests.some((request) => request.owner.toLowerCase() === account.toLowerCase()),
      ) ?? [])
    : [];
  const issuers = account
    ? (currentSnapshot?.platforms.filter((platform) =>
        currentSnapshot.roles.issuerPlatforms.some((address) => address.toLowerCase() === platform.address.toLowerCase()),
      ) ?? [])
    : [];
  return (
    <div className="journey-content">
      <div className="entry-intro journey-intro">
        <span className="eyebrow">{investor ? "YOUR EARLY EXIT" : "YOUR PLATFORM FACILITY"}</span>
        <h1>{investor ? "Find your early exit." : "Manage your platform facility."}</h1>
        <p>
          {investor
            ? "Find your positions and compare waiting with an earlier payout. Review the fee before you sign."
            : "Manage earlier exits, settlement cash, and repayment through your platform’s credit line."}
        </p>
      </div>
      {!account ? (
        <section className="journey-connect">
          {investor ? <Wallet size={24} strokeWidth={1.3} /> : <Building2 size={24} strokeWidth={1.3} />}
          <div>
            <h2>{investor ? "Find the positions you already hold." : "Open your issuer workspace."}</h2>
            <p>
              {investor
                ? "Connect the wallet that holds your platform shares. You can explore platform terms first."
                : "Connect your platform’s issuer wallet. Permissions come from the deployed contracts."}
            </p>
          </div>
          <button className="button" onClick={() => void connect()}>
            {investor ? "Connect my wallet" : "Connect issuer wallet"} <ArrowRight size={14} />
          </button>
        </section>
      ) : (
        <section className="journey-results">
          <div className="row between">
            <h2>{investor ? "Your positions" : "Your platforms"}</h2>
            <span className="mono muted">{short(account)}</span>
          </div>
          {preview && (
            <p className="notice">
              Layout preview uses illustrative records. Return to chain data before reviewing a transaction.
            </p>
          )}
          {loading && !currentSnapshot && <p role="status">Reading this wallet’s platform access…</p>}
          {!investor && !currentSnapshot && <a className="button" href="#/onboarding">Start platform onboarding <ArrowRight size={14} /></a>}
          {currentSnapshot &&
            (investor ? (
              owned.length ? (
                <div className="journey-platforms">
                  {owned.map((platform) => {
                    const queued = platform.requests.filter(
                      (request) => request.status === "Queued" && request.owner.toLowerCase() === account.toLowerCase(),
                    );
                    return (
                      <article className="journey-platform" key={platform.address}>
                        <div className="row between">
                          <h3>{platform.name}</h3>
                          <Badge tone={platform.gated ? "warn" : "muted"}>{platform.gated ? "Gated" : "Position found"}</Badge>
                        </div>
                        <dl className="key-values">
                          <div>
                            <dt>Available position NAV</dt>
                            <dd>{money((platform.holding * platform.nav) / 10n ** 18n)} USDG</dd>
                          </div>
                          <div>
                            <dt>Next settlement</dt>
                            <dd>{date(platform.nextWindow)}</dd>
                          </div>
                        </dl>
                        <div className="row">
                          {platform.holding > 0n && (
                            <a className="button" href={`#/exit/${platform.address}`}>
                              Review early exit <ArrowRight size={14} />
                            </a>
                          )}
                          <a className="button secondary" href="#/positions">
                            View position details
                          </a>
                        </div>
                        {queued.map((request) => (
                          <a
                            className="journey-request"
                            key={String(request.id)}
                            href={`#/exit/${platform.address}?request=${request.id}`}
                          >
                            <span>
                              Queued request #{String(request.id)} · {money(request.navValue)} USDG
                            </span>
                            <span>
                              Review exit <ArrowRight size={12} />
                            </span>
                          </a>
                        ))}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="journey-empty">
                  <h3>No positions found for this wallet.</h3>
                  <p>Explore the supported platforms, or connect the wallet holding your platform shares.</p>
                  <a className="button secondary" href={`#/terms?from=${role}`}>
                    Explore platforms <ArrowRight size={14} />
                  </a>
                </div>
              )
            ) : issuers.length ? (
              <div className="journey-platforms">
                {issuers.map((platform) => (
                  <article className="journey-platform" key={platform.address}>
                    <div className="row between">
                      <h3>{platform.name}</h3>
                      <Badge tone="good">Issuer access</Badge>
                    </div>
                    <p>Inspect settlement cash, manage investor eligibility, and review your facility obligations.</p>
                    <a className="button" href={`#/issuer?platform=${platform.address}`}>
                      Open issuer workspace <ArrowRight size={14} />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <div className="journey-empty">
                <h3>This wallet has no issuer access.</h3>
                <p>
                  Start onboarding for a new platform, or switch to your platform’s designated issuer wallet.
                </p>
                <a className="button" href="#/onboarding">
                  Start platform onboarding <ArrowRight size={14} />
                </a>
              </div>
            ))}
        </section>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="button secondary" onClick={() => void refresh()}>
            Retry platform read
          </button>
        </div>
      )}
      <div className="journey-links">
        <a className="inline-link" href={`#/terms?from=${role}`}>
          Explore platform terms <ArrowRight size={13} />
        </a>
      </div>
    </div>
  );
}
