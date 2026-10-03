import { useState } from "react";
import type { Address } from "viem";
import type { Action } from "../chain/model";
import { useApp } from "./context";
import { parseAmount } from "../chain/amounts";
import { errorMessage } from "../chain/client";
export function FundingForm({
  kind,
  platform,
  vault,
  title,
  description,
}: {
  kind: "deposit" | "depositCash" | "postReserve" | "depositCapital" | "withdrawCapital" | "vaultDeposit" | "vaultWithdraw";
  platform?: Address;
  vault?: Address;
  title: string;
  description: string;
}) {
  const { account, connect, review, preview } = useApp();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    try {
      parseAmount(amount);
      if (!account) {
        void connect();
        return;
      }
      const action = platform ? { kind, platform, amount } : vault ? { kind, vault, amount } : { kind, amount };
      review(action as Action, title, description);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="funding-form">
      <h3>{title}</h3>
      <p className="text-small muted">{description}</p>
      <label className="field">
        <span>Amount · USDG</span>
        <div className="row">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
            placeholder="0.00"
            aria-label={`${title} amount`}
          />
          <button className="button secondary" disabled={preview} onClick={submit}>
            {account ? "Review" : "Connect wallet"}
          </button>
        </div>
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
