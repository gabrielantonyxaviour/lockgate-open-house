import { useRef, useState } from "react";
import { X, CheckCircle2, LoaderCircle } from "lucide-react";
import { sendAction } from "../chain/actions";
import { errorMessage } from "../chain/client";
import type { Action, TransactionState } from "../chain/model";
import { useApp } from "./context";
import { Explorer, Badge } from "./primitives";
import { useDialog } from "./dialog";
export interface Review {
  action: Action;
  title: string;
  description: string;
  account: string;
}
export function Transaction({ review, onClose }: { review: Review; onClose: () => void }) {
  const { snapshot, refresh, refreshAfterTransaction, account, walletChainId } = useApp();
  const [state, setState] = useState<TransactionState | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const pending = Boolean(state && !["error", "success"].includes(state.phase));
  useDialog(dialog, onClose, pending);
  const submit = async () => {
    if (!snapshot || !account || review.account.toLowerCase() !== account.toLowerCase()) {
      setState({ phase: "error", message: "The wallet changed. Close this review and start again." });
      return;
    }
    try {
      await sendAction(review.action, snapshot, setState);
      await (refreshAfterTransaction || refresh)();
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "error",
        message: current?.confirmationUnknown ? current.message : errorMessage(error),
      }));
    }
  };
  const action = review.action;
  const walletChanged = account?.toLowerCase() !== review.account.toLowerCase();
  const wrongNetwork = walletChainId !== undefined && walletChainId !== 421614;
  const labels: Record<string, string> = {
    requestId: "Redemption request", advanceId: "Advance", platformKind: "Redemption schedule",
    name: "Platform name", interval: "Window interval · seconds", shareNav: "NAV · USDG per share",
    issuer: "Issuer wallet", limit: "Credit limit · USDG", reserveBps: "Reserve requirement · bps",
    riskBps: "Risk premium · bps", maxUtilizationBps: "Utilization cap · bps",
    maxConcentrationBps: "Concentration cap · bps", seconds: "Repayment grace · seconds",
    minFeeBps: "Fee floor · bps", maxTenor: "Maximum tenor · seconds", concentrationBps: "Concentration cap · bps",
    expiry: "Mandate expiry", approved: "Platform approved", checkGate: "Check redemption gate",
    maxNavAge: "Maximum NAV age · seconds", gated: "Pause new redemptions", allowed: "Wallet eligible",
    paused: "Pause new advances", tranche: "Capital tranche", lender: "Lender wallet",
  };
  return (
    <div className="dialog-backdrop">
      <div className="transaction-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tx-title">
        <div className="row between">
          <Badge tone="warn">Arbitrum Sepolia transaction</Badge>
          <button className="icon-button" aria-label="Close transaction review" disabled={pending} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <h2 id="tx-title">{state?.phase === "success" ? "Transaction confirmed" : review.title}</h2>
        <p>{review.description}</p>
        {(walletChanged || wrongNetwork) && <div className="notice warn" role="alert">
          {walletChanged ? "Your wallet account changed. Start a new review before signing." : "Switch your wallet to Arbitrum Sepolia before signing."}
        </div>}
        <dl className="key-values">
          <div>
            <dt>Network</dt>
            <dd>Arbitrum Sepolia · 421614</dd>
          </div>
          <div>
            <dt>Signing wallet</dt>
            <dd>
              <Explorer address={review.account} />
            </dd>
          </div>
          {"platform" in action && (
            <div>
              <dt>Platform</dt>
              <dd>
                <Explorer address={action.platform} />
              </dd>
            </div>
          )}
          {"vault" in action && (
            <div>
              <dt>Partner vault</dt>
              <dd>
                <Explorer address={action.vault} />
              </dd>
            </div>
          )}
          {"amount" in action && (
            <div>
              <dt>Amount</dt>
              <dd>
                {action.amount} {["exitNow", "requestRedeem", "facilityRedeem"].includes(action.kind) ? "shares" : action.kind === "setNav" ? "USDG per share" : "USDG"}
              </dd>
            </div>
          )}
          {"account" in action && (
            <div>
              <dt>Target wallet</dt>
              <dd>
                <Explorer address={action.account} />
              </dd>
            </div>
          )}
          {Object.entries(action)
            .filter(([k]) => !["kind", "platform", "vault", "account", "amount", "quotedAt", "minUsdgOut"].includes(k))
            .map(([key, value]) => (
              <div key={key}>
                <dt>{labels[key] || key.replace(/([A-Z])/g, " $1")}</dt>
                <dd>{key === "tranche" ? value === 0 ? "Senior" : "Junior" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</dd>
              </div>
            ))}
        </dl>
        <div className="notice">
          Confirmed transactions are final. Funding may require a separate USDG approval.
        </div>
        {state && (
          <div className={`tx-progress ${state.phase === "error" ? "tx-error" : ""}`} role="status" aria-live="polite">
            <div className="row">
              {state.phase === "success" ? (
                <CheckCircle2 size={16} />
              ) : pending ? (
                <LoaderCircle className="spin" size={16} />
              ) : null}
              {state.message}
            </div>
            {state.hash && <Explorer hash={state.hash}>View transaction</Explorer>}
            {state.createdPlatform && <div className="row"><a className="button secondary" href={`#/platform/${state.createdPlatform}`} onClick={onClose}>Open platform</a><a className="inline-link" href={`#/judge?platform=${state.createdPlatform}`} onClick={onClose}>Open walkthrough</a></div>}
          </div>
        )}
        <div className="row between">
          <button className="button secondary" onClick={onClose} disabled={pending}>
            {state?.phase === "success" ? "Done" : "Cancel"}
          </button>
          {state?.phase !== "success" && (
            <button
              className="button"
              disabled={pending || !account || walletChanged || wrongNetwork || state?.confirmationUnknown}
              onClick={submit}
            >
              {pending
                ? state?.phase === "pending" ? "Confirming on chain…" : state?.phase === "checking" ? "Checking transaction…" : "Waiting for wallet…"
                : state?.confirmationUnknown
                  ? "Check explorer before retrying"
                  : state?.phase === "error"
                    ? "Retry transaction"
                    : "Confirm in wallet"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
