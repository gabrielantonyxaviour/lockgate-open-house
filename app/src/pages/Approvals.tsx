import { useState } from "react";
import { isAddressEqual } from "viem";
import { parseProposal, verifyProposal, approveProposal, type ProposalReview } from "../chain/proposals";
import { errorMessage } from "../chain/client";
import type { TransactionState } from "../chain/model";
import { useApp } from "../ui/context";
import { Panel, PageHead, Empty, Badge, Explorer, money, date } from "../ui/primitives";
export default function Approvals() {
  const { account, connect, preview, refresh, refreshAfterTransaction } = useApp();
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState<ProposalReview | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState<TransactionState | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setError("");
    setChecked(null);
    setState(null);
    setBusy(true);
    try {
      if (preview) throw new Error("Return to chain data to verify a proposal.");
      setChecked(await verifyProposal(parseProposal(input)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const permitted = account && checked && (isAddressEqual(account, checked.owner) || isAddressEqual(account, checked.signer));
  const approve = async () => {
    if (!account) {
      void connect();
      return;
    }
    if (!checked || preview) return;
    setBusy(true);
    setError("");
    try {
      await approveProposal(checked, account, setState);
      await (refreshAfterTransaction ?? refresh)();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <PageHead
        eyebrow="PARTNER APPROVAL INBOX"
        title="The partner has the final word."
        description="Review exact engine terms against the filed on-chain digest and your vault mandate before authorizing funding."
      />
      <div className="grid-two">
        <Panel title="Import an engine proposal">
          <div className="stack">
            <div className="notice">
              An automatic proposal feed is not connected. The contracts store hashes, so this screen requires the full engine
              payload. Importing JSON does not file or fund it.
            </div>
            <label className="field">
              Proposal JSON
              <textarea
                rows={9}
                maxLength={32000}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setChecked(null);
                  setState(null);
                }}
                placeholder={'{"vault":"0x…","chainId":421614,"proposal":{…}}'}
                aria-label="Engine proposal JSON"
                disabled={busy || state?.confirmationUnknown}
              />
              <small>
                Include the vault, chain ID, and complete signed terms. Amounts and timestamps must be decimal strings. Do not
                paste keys.
              </small>
            </label>
            <button className="button" onClick={verify} disabled={!input || busy || preview || state?.confirmationUnknown}>
              {busy ? "Verifying…" : "Verify against contract"}
            </button>
            {error && !state?.confirmationUnknown && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
          </div>
        </Panel>
        <Panel title="Proposal review">
          {checked ? (
            <div className="stack">
              <Badge tone={checked.ready ? "good" : "warn"}>
                {checked.ready ? "Mandate checks passed" : "Not ready to fund"}
              </Badge>
              <dl className="key-values">
                <div>
                  <dt>Vault</dt>
                  <dd>
                    <Explorer address={checked.vault} />
                  </dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>
                    <Explorer address={checked.proposal.platform} />
                  </dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>
                    <Explorer address={checked.proposal.recipient} />
                  </dd>
                </div>
                <div>
                  <dt>NAV amount</dt>
                  <dd>{money(checked.proposal.navValue)} USDG</dd>
                </div>
                <div>
                  <dt>Fee</dt>
                  <dd>
                    {money(checked.proposal.fee)} USDG · {checked.proposal.feeBps} bps
                  </dd>
                </div>
                <div>
                  <dt>Payout</dt>
                  <dd>{money(checked.proposal.payout)} USDG</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{date(checked.proposal.dueAt)}</dd>
                </div>
                <div>
                  <dt>Proposal expires</dt>
                  <dd>{date(checked.proposal.expiresAt)}</dd>
                </div>
                <div>
                  <dt>Nonce</dt>
                  <dd>{String(checked.proposal.nonce)}</dd>
                </div>
              </dl>
              <details>
                <summary>Filed digest & verification</summary>
                <p className="mono digest">{checked.digest}</p>
                <p className="text-small">{checked.reason}</p>
              </details>
              <div className="notice">
                Confirming funds the exact proposal from the partner vault. This blockchain transaction cannot be undone. All
                checks run again before signing.
              </div>
              {!permitted && (
                <p className="text-small muted">
                  Only this vault’s owner or designated partner signer can authorize the proposal.
                </p>
              )}
              <button
                className="button"
                disabled={
                  !checked.ready || !permitted || busy || preview || state?.phase === "success" || state?.confirmationUnknown
                }
                onClick={approve}
              >
                {state?.phase === "success" ? "Funding confirmed" : busy ? "Waiting for wallet…" : "Authorize funding in wallet"}
              </button>
              {state && (
                <div className="tx-progress" role="status">
                  {state.message}
                  {state.hash && <Explorer hash={state.hash}>View transaction</Explorer>}
                </div>
              )}
            </div>
          ) : (
            <Empty title="No verified proposal selected">
              Import engine terms to see payout, fee, tenor, expiry, recipient, and mandate checks here.
            </Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
