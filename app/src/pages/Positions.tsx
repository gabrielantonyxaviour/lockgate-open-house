import { ArrowUpRight } from "lucide-react";
import { useApp } from "../ui/context";
import { PageHead, Panel, Empty, money, Badge, date } from "../ui/primitives";
import { FundingForm } from "../ui/FundingForm";
export default function Positions() {
  const { snapshot, account, connect, review, preview } = useApp();
  if (!snapshot) return null;
  return (
    <div className="stack">
      <PageHead
        eyebrow="YOUR PORTFOLIO"
        title="Your next move."
        description="Keep your place in the redemption queue, or review a quote to receive USDG today."
      />
      {!account && !preview ? (
        <Panel>
          <Empty
            title="Connect to see your positions"
            action={
              <button className="button" onClick={connect}>
                Connect wallet
              </button>
            }
          >
            Balances and requests are read for your connected wallet. You can browse platforms without connecting.
          </Empty>
        </Panel>
      ) : (
        <>
          {snapshot.platforms.map((p) => (
            <Panel key={p.address}>
              <div className="position-heading">
                <div>
                  <span className="eyebrow">PLATFORM</span>
                  <h2>{p.name}</h2>
                </div>
                <Badge tone={p.blocked ? "warn" : "muted"}>{p.blocked ? "Wallet blocked" : "Wallet position"}</Badge>
              </div>
              <div className="position-summary">
                <div>
                  <span>Available shares</span>
                  <strong>{money(p.holding, 18)}</strong>
                </div>
                <div>
                  <span>Position NAV</span>
                  <strong>
                    {money((p.holding * p.nav) / 10n ** 18n)} <small>USDG</small>
                  </strong>
                </div>
                <div>
                  <span>Next window</span>
                  <strong className="date-value">{date(p.nextWindow)}</strong>
                </div>
              </div>
              <div className="row">
                <a className="button" href={`#/exit/${p.address}`}>
                  Exit today <ArrowUpRight size={14} />
                </a>
                <a className="button secondary" href={`#/exit/${p.address}?mode=queue`}>
                  Request redemption
                </a>
                <a className="button text" href={`#/platform/${p.address}`}>
                  View platform
                </a>
              </div>
              {p.holding === 0n && (
                <FundingForm
                  kind="deposit"
                  platform={p.address}
                  title="Fund a position"
                  description="Use USDG to receive platform shares before requesting an exit."
                />
              )}
              <div className="request-section">
                <h3>Your redemption requests</h3>
                {p.requests.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Request</th>
                          <th>NAV remaining</th>
                          <th>Requested</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.requests.map((r) => {
                          const advance = snapshot.creditLine.advances.find((a) => a.id === r.advanceId);
                          const label =
                            r.status === "Advanced" && advance?.remaining === 0n ? "Exit paid · balance cleared" : r.status;
                          return (
                            <tr key={String(r.id)}>
                              <td data-label="Request">#{String(r.id)}</td>
                              <td data-label="NAV remaining">{money(r.navValue)} USDG</td>
                              <td data-label="Requested">{date(r.requestedAt)}</td>
                              <td data-label="Status">
                                <Badge tone={r.status === "Queued" ? "muted" : r.status === "Cancelled" ? "warn" : "good"}>
                                  {label}
                                </Badge>
                              </td>
                              <td data-label="Actions">
                                {r.status === "Queued" ? (
                                  <div className="row">
                                    <a className="button secondary" href={`#/exit/${p.address}?request=${r.id}`}>
                                      Exit early
                                    </a>
                                    <button
                                      className="button text"
                                      disabled={preview}
                                      onClick={() =>
                                        review(
                                          { kind: "cancel", platform: p.address, requestId: r.id },
                                          "Cancel queued redemption",
                                          "Return the remaining escrowed shares to your wallet. You can request redemption again, but this transaction itself cannot be undone.",
                                        )
                                      }
                                    >
                                      Cancel request
                                    </button>
                                  </div>
                                ) : r.advanceId > 0n ? (
                                  <a className="inline-link" href={`#/advance/${r.advanceId}`}>
                                    Receipt
                                  </a>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="No redemption requests">Your queued and completed requests will appear here.</Empty>
                )}
              </div>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
