import PartnerOperations from "./PartnerOperations";
import Facility from "./Facility";
import { VaultControls } from "../ui/VaultControls";
import { useState } from "react";
import { useApp } from "../ui/context";
import { Panel, PageHead, money, date, Badge, Explorer, Empty, Metric } from "../ui/primitives";
import { FundingForm } from "../ui/FundingForm";
export default function Capital() {
  const { snapshot, account, preview } = useApp();
  const [selected, setSelected] = useState("");
  const vault = snapshot?.vaults.find((v) => v.address === selected) || snapshot?.vaults[0];
  const owner = Boolean(vault && account?.toLowerCase() === vault.owner.toLowerCase() && !preview);
  return (
    <div className="stack">
      <PageHead
        eyebrow="CAPITAL PARTNERS"
        title="Your vault. Your mandate."
        description="Partner capital stays in segregated partner-owned vaults. Lockgate proposes an advance; the partner authorizes funding."
      />
      <div className="grid-two grid-equal">
        {snapshot?.vaults.map((v) => (
          <button
            className={`vault-card ${v.address === vault?.address ? "selected" : ""}`}
            key={v.address}
            onClick={() => setSelected(v.address)}
          >
            <div className="row between">
              <span>{v.name}</span>
              <Badge tone={v.paused ? "warn" : "muted"}>
                {v.paused ? "Paused" : v.idle === 0n ? "Unfunded" : "Capital on hand"}
              </Badge>
            </div>
            <strong>
              {money(v.idle)} <small>USDG</small>
            </strong>
            <span className="text-small muted">Idle partner capital</span>
          </button>
        ))}
      </div>
      {vault ? (
        <>
          <div className="metrics">
            <Metric label="Total assets" value={money(vault.totalAssets)} caption="Idle + outstanding principal" />
            <Metric label="Idle capital" value={money(vault.idle)} caption="Partner-controlled USDG" />
            <Metric label="Outstanding" value={money(vault.outstandingPrincipal)} caption="Funded principal" />
            <Metric label="Reserve cash" value={money(vault.reserveCash)} caption="Platform-specific buffers" />
          </div>
          <div className="grid-two">
            <Panel title="Vault mandate">
              <dl className="key-values">
                <div>
                  <dt>Partner owner</dt>
                  <dd>
                    <Explorer address={vault.owner} />
                  </dd>
                </div>
                <div>
                  <dt>Authorized signer</dt>
                  <dd>
                    <Explorer address={vault.mandate.signer} />
                  </dd>
                </div>
                <div>
                  <dt>Fee floor</dt>
                  <dd>{vault.mandate.minFeeBps} bps</dd>
                </div>
                <div>
                  <dt>Maximum tenor</dt>
                  <dd>{String(vault.mandate.maxTenor)} seconds</dd>
                </div>
                <div>
                  <dt>Concentration cap</dt>
                  <dd>{vault.mandate.concentrationBps} bps</dd>
                </div>
                <div>
                  <dt>Mandate expiry</dt>
                  <dd>{date(vault.mandate.expiry)}</dd>
                </div>
                <div>
                  <dt>Vault contract</dt>
                  <dd>
                    <Explorer address={vault.address} />
                  </dd>
                </div>
              </dl>
              <a className="button secondary" href="#/approvals">
                Review advance proposals
              </a>
            </Panel>
            <Panel title="Capital movements">
              {owner ? (
                <>
                  <FundingForm
                    kind="vaultDeposit"
                    vault={vault.address}
                    title="Deposit partner capital"
                    description="Fund your vault with USDG. Only the partner owner can perform this action."
                  />
                  <FundingForm
                    kind="vaultWithdraw"
                    vault={vault.address}
                    title="Withdraw idle capital"
                    description="Withdraw available idle capital to your partner wallet. Deployed principal remains in the vault’s book."
                  />
                </>
              ) : (
                <Empty title="Partner owner required">
                  Read-only access. Connect the vault owner wallet to deposit or withdraw its capital.
                </Empty>
              )}
            </Panel>
          </div>
          <VaultControls key={vault.address} vault={vault} permitted={owner} />
          <PartnerOperations key={vault.address} vault={vault} />
          <Panel title="Partner-funded advances">
            {vault.advances?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Advance</th>
                      <th>Platform</th>
                      <th>Principal</th>
                      <th>Owed</th>
                      <th>Due</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vault.advances.map((a) => (
                      <tr key={String(a.id)}>
                        <td data-label="Advance">#{String(a.id)}</td>
                        <td data-label="Platform">
                          <Explorer address={a.platform} />
                        </td>
                        <td data-label="Principal · USDG">{money(a.principal)}</td>
                        <td data-label="Owed · USDG">{money(a.owed)}</td>
                        <td data-label="Due">{date(a.dueAt)}</td>
                        <td data-label="Status">
                          <Badge tone={a.owed === 0n ? "good" : a.status === 3 ? "warn" : "muted"}>
                            {a.owed === 0n ? "Cleared" : ["None", "Active", "Repaid", "Late", "Written off"][a.status]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No partner-funded advances">
                Confirmed advances will appear here when this vault funds a proposal.
              </Empty>
            )}
          </Panel>
        </>
      ) : (
        <Empty title="Partner vaults unavailable">Refresh chain data to read the deployed vaults.</Empty>
      )}
      <Facility />
    </div>
  );
}
