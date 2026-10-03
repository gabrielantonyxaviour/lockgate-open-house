import { Select } from "../ui/Select";
import { useState } from "react";
import { useApp } from "../ui/context";
import { PageHead, Panel, Empty, money, Metric, Badge, Explorer } from "../ui/primitives";
import { SettlementWaterfall } from "../ui/SettlementWaterfall";
import { FundingForm } from "../ui/FundingForm";
import { AdvanceTable } from "./Activity";
import { OperatorControls, IssuerControls } from "./Controls";
export function Issuer() {
  const { snapshot, account, preview, connect } = useApp();
  const [selected, setSelected] = useState("");
  const p = snapshot?.platforms.find((p) => p.address === selected) || snapshot?.platforms[0];
  const permitted = p && account?.toLowerCase() === p.issuer.toLowerCase();
  return (
    <div className="stack">
      <PageHead
        eyebrow="ISSUER WORKSPACE"
        title="Settle with confidence."
        description="Inspect the platform cash waterfall, fund settlement, and manage issuer controls."
      />
      <div className="notice">
        {permitted
          ? "Your wallet is this platform’s issuer."
          : preview
            ? "Read-only layout preview."
            : "Read-only workspace. Issuer changes require the platform’s issuer wallet."}
        {!account && !preview && (
          <button className="button secondary" onClick={connect}>
            Connect wallet
          </button>
        )}
      </div>
      {p ? (
        <>
          <label className="field">
            Platform
            <Select
              label="Platform"
              value={p.address}
              onValueChange={setSelected}
              options={snapshot!.platforms.map((p) => ({ value: p.address, label: p.name }))}
            />
          </label>
          <div className="grid-two">
            <Panel title="Settlement waterfall">
              <SettlementWaterfall platform={p} />
              <a className="button secondary" href={`#/platform/${p.address}`}>
                Inspect / process window
              </a>
              <FundingForm
                kind="depositCash"
                platform={p.address}
                title="Deposit settlement cash"
                description="Transfer USDG to this platform contract. Anyone can supply cash; this is not a purchase of shares."
              />
            </Panel>
            <Panel title="Issuer controls">
              <dl className="key-values">
                <div>
                  <dt>Issuer</dt>
                  <dd>
                    <Explorer address={p.issuer} />
                  </dd>
                </div>
                <div>
                  <dt>Current NAV</dt>
                  <dd>{money(p.nav)} USDG / share</dd>
                </div>
                <div>
                  <dt>Gate</dt>
                  <dd>
                    <Badge tone={p.gated ? "warn" : "good"}>{p.gated ? "Gated" : "Not gated"}</Badge>
                  </dd>
                </div>
              </dl>
              <IssuerControls platform={p} permitted={Boolean(permitted) && !preview} />
            </Panel>
          </div>
          <Panel title="Open settlement requests">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Investor</th>
                    <th>NAV</th>
                    <th>Status</th>
                    <th>Advance</th>
                  </tr>
                </thead>
                <tbody>
                  {(p.queue ?? p.requests).map((r) => (
                    <tr key={String(r.id)}>
                      <td data-label="Request">#{String(r.id)}</td>
                      <td data-label="Investor">
                        <Explorer address={r.owner} />
                      </td>
                      <td data-label="NAV · USDG">{money(r.navValue)}</td>
                      <td data-label="Status">{r.status}</td>
                      <td data-label="Advance">
                        {r.advanceId > 0n ? (
                          <a className="inline-link" href={`#/advance/${r.advanceId}`}>
                            #{String(r.advanceId)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!(p.queue ?? p.requests).length && <Empty title="No open requests">The platform’s settlement queue is empty.</Empty>}
          </Panel>
        </>
      ) : (
        <Empty title="No registered platform">Registering a platform requires the Lockgate owner.</Empty>
      )}
    </div>
  );
}
export function Operations() {
  const { snapshot, account, connect, review, preview } = useApp();
  if (!snapshot) return null;
  const l = snapshot.creditLine;
  const permitted = l.owner.toLowerCase() === account?.toLowerCase() && !preview;
  return (
    <div className="stack">
      <PageHead
        eyebrow="LOCKGATE OPERATIONS"
        title="Liquidity, under control."
        description="Manage own-book capital and platform limits. Operational writes require the credit-line owner."
        action={<Badge tone={l.paused ? "warn" : "good"}>{l.paused ? "Paused" : "Not paused"}</Badge>}
      />
      <div className="metrics">
        <Metric label="Idle capital" value={money(l.capital)} caption="USDG available before platform checks" />
        <Metric label="Outstanding principal" value={money(l.outstanding)} caption="Own-book funded advances" />
        <Metric label="Late outstanding" value={money(l.lateOutstanding)} caption="Unpaid late principal" />
        <Metric label="Earned fees" value={money(l.earnedFees)} caption="Contract accounting" />
      </div>
      {!permitted && (
        <div className="notice">
          This wallet has read-only access. Only the Lockgate owner can change capital and risk settings.
          {!account && !preview && (
            <button className="button secondary" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      )}
      <div className="grid-two">
        <Panel title="Capital management">
          {permitted ? (
            <>
              <FundingForm
                kind="depositCapital"
                title="Deposit own-book capital"
                description="Transfer USDG from your wallet into the credit line."
              />
              <FundingForm
                kind="withdrawCapital"
                title="Withdraw capital"
                description="Withdraw idle capital to the owner wallet. The contract enforces its available capital."
              />
            </>
          ) : (
            <dl className="key-values">
              <div>
                <dt>Owner</dt>
                <dd>
                  <Explorer address={l.owner} />
                </dd>
              </div>
              <div>
                <dt>Available capital</dt>
                <dd>{money(l.capital)} USDG</dd>
              </div>
            </dl>
          )}
          <button
            className="button secondary"
            disabled={!permitted}
            onClick={() =>
              review(
                { kind: l.paused ? "unpause" : "pause" },
                l.paused ? "Unpause credit line" : "Pause credit line",
                l.paused
                  ? "Allow new advances when all contract checks pass."
                  : "Pause new draws. Existing repayment obligations remain.",
              )
            }
          >
            {l.paused ? "Unpause new advances" : "Pause new advances"}
          </button>
        </Panel>
        <Panel title="Exposure & reserve">
          {snapshot.platforms.map((p) => (
            <div className="exposure-row" key={p.address}>
              <div className="row between">
                <a href={`#/platform/${p.address}`}>{p.name}</a>
                <strong>{money(p.exposure)} USDG</strong>
              </div>
              <div className="exposure-bar">
                <span style={{ width: `${p.limit > 0n ? Math.min(100, Number((p.exposure * 100n) / p.limit)) : 0}%` }} />
              </div>
              <div className="row between text-small muted">
                <span>Limit {money(p.limit)}</span>
                <span>Reserve {money(p.reserve)}</span>
              </div>
            </div>
          ))}
        </Panel>
      </div>
      <OperatorControls permitted={permitted} />
      <Panel title="Advance ledger">
        <AdvanceTable advances={[...l.advances].reverse()} />
      </Panel>
    </div>
  );
}
