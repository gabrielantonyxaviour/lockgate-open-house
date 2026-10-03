import { Select } from "../ui/Select";
import { useState } from "react";
import { RecentEvents } from "./RecentEvents";
import type { Advance } from "../chain/model";
import { useApp } from "../ui/context";
import { Panel, PageHead, Money, money, Badge, date, Explorer, Empty } from "../ui/primitives";
export function advanceLabel(a: Advance) {
  return a.remaining === 0n ? (a.status === "Late" ? "Recovered" : "Repaid") : a.status;
}
export function AdvanceTable({ advances }: { advances: Advance[] }) {
  return advances.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Advance</th>
            <th>Platform</th>
            <th>Principal</th>
            <th>Fee</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          {advances.map((a) => (
            <tr key={String(a.id)}>
              <td data-label="Advance">
                <a className="inline-link" href={`#/advance/${a.id}`}>
                  #{String(a.id)}
                </a>
              </td>
              <td data-label="Platform">
                <Explorer address={a.source} />
              </td>
              <td data-label="Principal · USDG">
                <Money value={a.principal} />
              </td>
              <td data-label="Fee · USDG">
                <Money value={a.fee} />
              </td>
              <td data-label="Remaining · USDG">
                <Money value={a.remaining} />
              </td>
              <td data-label="Status">
                <Badge tone={a.remaining === 0n ? "good" : a.status === "Late" ? "warn" : "muted"}>{advanceLabel(a)}</Badge>
              </td>
              <td data-label="Due">{date(a.dueAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No advances yet">Confirmed exits funded by Lockgate will appear here.</Empty>
  );
}
export default function Activity() {
  const { snapshot } = useApp();
  const [status, setStatus] = useState("all");
  const advances = (snapshot?.creditLine.advances || []).filter(
    (a) => status === "all" || advanceLabel(a).toLowerCase() === status,
  );
  return (
    <div className="stack">
      <PageHead
        eyebrow="ON-CHAIN LEDGER"
        title="Every advance, accounted for."
        description="Explore funding, repayment, and reserve recovery from the deployed credit line. Amounts are USDG."
      />
      <Panel>
        <div className="filter-bar">
          <h2>Advance ledger</h2>
          <Select
            label="Advance status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "repaid", label: "Repaid" },
              { value: "late", label: "Late" },
              { value: "recovered", label: "Recovered" },
            ]}
          />
        </div>
        <AdvanceTable advances={[...advances].reverse()} />
      </Panel>
      <RecentEvents />
      <div className="notice">
        This ledger shows current advance state. The explorer holds transaction history. Partner vault advances are shown in
        Partner capital.
      </div>
    </div>
  );
}
export function AdvanceDetail({ id }: { id: string }) {
  const { snapshot, review, preview, account, connect, loading, error, refresh } = useApp();
  const a = snapshot?.creditLine.advances.find((a) => String(a.id) === id);
  if (!a && loading)
    return <div className="loading-state" role="status"><h1>Reading receipt…</h1><p>Fetching the latest advance record.</p></div>;
  if (!a)
    return (
      <Empty title={error ? "Receipt unavailable" : "Advance not found"}
        action={<button className="button secondary" onClick={() => void refresh()}>Refresh receipt</button>}>
        {error ? "The latest receipt could not be read. Try refreshing, or return to the " : "Return to the "}
        <a className="inline-link" href="#/activity">
          advance ledger
        </a>{" "}
        to select a recorded advance.
      </Empty>
    );
  const canLate = a.status === "Active" && a.remaining > 0n && BigInt(Math.floor(Date.now() / 1000)) >= a.dueAt + a.grace;
  const p = snapshot!.platforms.find((p) => p.address.toLowerCase() === a.source.toLowerCase());
  return (
    <div className="stack">
      <PageHead
        eyebrow="ADVANCE RECEIPT"
        title={`Advance #${a.id}`}
        description="An early exit funded by Lockgate, with repayment owed by the platform."
        action={<Badge tone={a.remaining === 0n ? "good" : a.status === "Late" ? "warn" : "muted"}>{advanceLabel(a)}</Badge>}
      />
      <div className="grid-two">
        <Panel title="The advance">
          <dl className="key-values">
            <div>
              <dt>Investor received</dt>
              <dd>{money(a.principal)} USDG</dd>
            </div>
            <div>
              <dt>Exit fee</dt>
              <dd>{money(a.fee)} USDG</dd>
            </div>
            <div>
              <dt>Original amount due</dt>
              <dd>{money(a.principal + a.fee)} USDG</dd>
            </div>
            <div>
              <dt>Remaining owed</dt>
              <dd>{money(a.remaining)} USDG</dd>
            </div>
            <div>
              <dt>Recovered / repaid</dt>
              <dd>{money(a.recovered)} USDG</dd>
            </div>
            <div>
              <dt>Funded</dt>
              <dd>{date(a.drawnAt)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{date(a.dueAt)}</dd>
            </div>
            <div>
              <dt>Grace period</dt>
              <dd>{String(a.grace)} seconds</dd>
            </div>
            <div>
              <dt>Investor</dt>
              <dd>
                <Explorer address={a.to} />
              </dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>
                <Explorer address={a.source} />
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Repayment lifecycle">
          <ol className="timeline">
            <li className="complete">
              <span />
              <div>
                <strong>Exit funded</strong>
                <p>{money(a.principal)} USDG paid to the investor.</p>
                <small>{date(a.drawnAt)}</small>
              </div>
            </li>
            <li className={a.remaining === 0n && a.status !== "Late" ? "complete" : ""}>
              <span />
              <div>
                <strong>{a.status === "Late" ? "Platform repayment due" : "Platform settlement"}</strong>
                <p>{a.status === "Late" ? "The platform missed its repayment deadline." : "Lockgate is repaid before remaining investor requests."}</p>
                <small>Due {date(a.dueAt)}</small>
              </div>
            </li>
            {a.status === "Late" && (
              <li className="complete">
                <span />
                <div>
                  <strong>Reserve recovery</strong>
                  <p>
                    {a.remaining === 0n ? "No amount remains owed." : "Some exposure remains unpaid."} Recovery is limited to the
                    platform’s reserve.
                  </p>
                </div>
              </li>
            )}
            <li className={a.remaining === 0n ? "complete" : ""}>
              <span />
              <div>
                <strong>{a.remaining === 0n ? "Balance cleared" : "Awaiting repayment"}</strong>
                <p>{money(a.remaining)} USDG still owed.</p>
              </div>
            </li>
          </ol>
          {canLate && (
            <button
              className="button secondary"
              disabled={preview}
              onClick={() =>
                account
                  ? review(
                      { kind: "markLate", advanceId: a.id },
                      "Recognize late repayment",
                      "The grace period has ended. This action marks the advance late and applies available platform reserve. It does not guarantee full recovery.",
                    )
                  : connect()
              }
            >
              {account ? "Mark late & apply reserve" : "Connect to mark late"}
            </button>
          )}
        </Panel>
      </div>
      {p && (
        <Panel title="Available protection">
          <div className="row between">
            <span className="text-small">Platform reserve</span>
            <strong>{money(p.reserve)} USDG</strong>
          </div>
          <p className="text-small muted">
            The reserve is shared across platform exposure. It is not a guarantee against the full outstanding balance.
          </p>
          <a className="button secondary" href={`#/platform/${p.address}`}>
            View platform settlement
          </a>
        </Panel>
      )}
    </div>
  );
}
