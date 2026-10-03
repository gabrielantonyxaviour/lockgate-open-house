import { useState } from "react";
import { isAddress } from "viem";
import type { Action } from "../chain/model";
import { parseAmount } from "../chain/amounts";
import { useApp } from "../ui/context";
import { Badge, Empty, Explorer, Metric, Panel, money } from "../ui/primitives";
import { Select } from "../ui/Select";

function AmountAction({ title, unit = "USDG", action, permitted, hint }: {
  title: string; unit?: string; action: (amount: string) => Action; permitted: boolean; hint: string;
}) {
  const { account, connect, review, preview } = useApp();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    try {
      parseAmount(amount);
      review(action(amount), title, hint);
      setError("");
    } catch {
      setError("Enter a positive amount with up to 6 decimals.");
    }
  };
  return <div className="funding-form">
    <h3>{title}</h3>
    <p className="text-small muted">{hint}</p>
    <label className="field">
      <span>Amount · {unit}</span>
      <div className="row">
        <input inputMode="decimal" placeholder="0.00" aria-label={`${title} amount`} value={amount}
          onChange={(event) => { setAmount(event.target.value); setError(""); }} />
        <button className="button secondary" disabled={preview || Boolean(account && !permitted)}
          onClick={account ? submit : connect}>{account ? "Review" : "Connect wallet"}</button>
      </div>
    </label>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

export default function Facility() {
  const { snapshot, account, preview, review, connect } = useApp();
  const [trancheValue, setTranche] = useState("0");
  const [lender, setLender] = useState("");
  const [permission, setPermission] = useState("true");
  const [lenderError, setLenderError] = useState("");
  const facility = snapshot?.facility;
  if (!facility) return <Panel title="Institutional facility" eyebrow="FACILITY CAPITAL">
    <Empty title="Facility data unavailable">Refresh chain data to read facility balances and your access.</Empty>
  </Panel>;
  const accounting = facility.accounting;
  const tranche = Number(trancheValue) as 0 | 1;
  const senior = tranche === 0;
  const governor = account?.toLowerCase() === facility.governor.toLowerCase();
  const borrower = account?.toLowerCase() === facility.borrower.toLowerCase();
  const lenderAllowed = Boolean(account && facility.approvedLender);
  const writable = Boolean(account && !preview);
  const shares = senior ? facility.seniorShares : facility.juniorShares;
  const idle = senior ? facility.seniorIdle : facility.juniorIdle;
  const claimable = senior ? facility.seniorClaimable : facility.juniorClaimable;
  const principal = senior ? accounting.seniorPrincipal : accounting.juniorPrincipal;
  const deficit = senior ? accounting.seniorDeficit : accounting.juniorDeficit;
  const approveLender = () => {
    if (!isAddress(lender)) { setLenderError("Enter a valid lender wallet address."); return; }
    setLenderError("");
    review({ kind: "facilityApproveLender", lender, approved: permission === "true" }, "Update lender access",
      permission === "true" ? "Allow this wallet to deposit into the institutional facility." : "Remove this wallet’s permission to make new deposits.");
  };
  return <section className="stack facility-content" aria-labelledby="facility-title">
    <div className="row between facility-heading">
      <div><span className="eyebrow">INSTITUTIONAL FACILITY</span><h2 id="facility-title">Facility capital</h2></div>
      <Badge tone={accounting.recovery ? "warn" : "good"}>{accounting.recovery ? "Recovery mode" : "Active"}</Badge>
    </div>
    <p className="text-small muted">Senior and junior capital finance Lockgate’s own book. Withdrawals depend on idle cash and facility terms.</p>
    <div className="metrics">
      <Metric label="Facility cash" value={money(accounting.cash)} caption="USDG held by the facility" />
      <Metric label="Drawn capital" value={money(accounting.drawn)} caption="Principal awaiting repayment" />
      <Metric label="Borrowing base" value={money(facility.borrowingBase)} caption="Supported by eligible receivables" />
      <Metric label="Available draw" value={money(facility.availableDraw)} caption="Current borrowing capacity · USDG" />
    </div>
    {accounting.recovery && <div className="notice warn">Recovery mode is active. New lending and draws may be restricted; review current capacity before continuing.</div>}
    <div className="grid-two grid-equal">
      <Panel title="Lender position">
        <label className="field">Capital tranche<Select label="Capital tranche" value={trancheValue} onValueChange={setTranche}
          options={[{ value: "0", label: "Senior" }, { value: "1", label: "Junior" }]} /></label>
        <dl className="key-values">
          <div><dt>Your shares</dt><dd>{money(shares)}</dd></div>
          <div><dt>Tranche principal</dt><dd>{money(principal)} USDG</dd></div>
          <div><dt>Tranche idle capital</dt><dd>{money(idle)} USDG</dd></div>
          <div><dt>Your claimable interest</dt><dd>{money(claimable)} USDG</dd></div>
          <div><dt>Tranche loss deficit</dt><dd>{money(deficit)} USDG</dd></div>
        </dl>
        <div className="notice">{!account ? "Connect your lender wallet to view your position and access." : lenderAllowed ? "This wallet is approved to lend." : "New deposits require approval from the facility governor."}</div>
        <AmountAction title={`Deposit ${senior ? "senior" : "junior"} capital`} permitted={lenderAllowed && (senior || !accounting.recovery)}
          action={(amount) => ({ kind: "facilityDeposit", tranche, amount })}
          hint={senior ? "Deposit USDG for senior shares. Senior principal ranks ahead of junior capital." : "Deposit USDG for junior shares. Junior capital absorbs losses before senior capital."} />
        <AmountAction title={`Withdraw ${senior ? "senior" : "junior"} capital`} unit="shares" permitted={shares > 0n}
          action={(amount) => ({ kind: "facilityRedeem", tranche, amount })}
          hint="Redeem your shares against available idle capital. Drawn principal cannot be withdrawn." />
        <button className="button secondary facility-claim" disabled={!writable || claimable === 0n}
          onClick={() => review({ kind: "facilityWithdrawInterest", tranche }, "Claim facility interest", "Withdraw this wallet’s available interest from the selected tranche.")}>
          Claim {senior ? "senior" : "junior"} interest
        </button>
      </Panel>
      <div className="stack">
        <Panel title="Borrower capital">
          <dl className="key-values">
            <div><dt>Borrower</dt><dd><Explorer address={facility.borrower} /></dd></div>
            <div><dt>Available draw</dt><dd>{money(facility.availableDraw)} USDG</dd></div>
            <div><dt>Drawn principal</dt><dd>{money(accounting.drawn)} USDG</dd></div>
            <div><dt>Accrued interest</dt><dd>{money(accounting.seniorInterestDue + accounting.juniorInterestDue)} USDG</dd></div>
          </dl>
          {!borrower && <p className="text-small muted">Only the designated borrower can draw capital. Any funded wallet may repay.</p>}
          <AmountAction title="Draw facility capital" permitted={borrower && !accounting.recovery && facility.availableDraw > 0n}
            action={(amount) => ({ kind: "facilityDraw", amount })} hint="Draw USDG against eligible receivables within the borrowing base." />
          <AmountAction title="Repay facility" permitted={Boolean(account)} action={(amount) => ({ kind: "facilityRepay", amount })}
            hint="Repay USDG to the facility. Accrued interest is paid before principal." />
        </Panel>
        <Panel title="Facility health">
          <dl className="key-values">
            <div><dt>Coverage</dt><dd><Badge tone={facility.solvent ? "good" : "warn"}>{facility.solvent ? "Solvent" : "Shortfall"}</Badge></dd></div>
            <div><dt>Senior rate</dt><dd>{(Number(accounting.seniorAprBps) / 100).toFixed(2)}% APR</dd></div>
            <div><dt>Junior rate</dt><dd>{(Number(accounting.juniorAprBps) / 100).toFixed(2)}% APR</dd></div>
          </dl>
          <p className="text-small muted">Refreshing health accrues interest and may enter recovery if facility limits are breached.</p>
          <div className="row facility-actions">
            <button className="button secondary" disabled={preview} onClick={() => account
              ? review({ kind: "facilityPoke" }, "Update facility health", "Accrue interest and evaluate facility limits. This may activate recovery mode.") : connect()}>Update facility health</button>
            <button className="button secondary" disabled={!writable || !accounting.recovery}
              onClick={() => review({ kind: "facilityRecognizeLoss" }, "Recognize facility loss", "Apply the recovery loss waterfall to junior capital first, then senior capital.")}>Recognize loss</button>
          </div>
        </Panel>
      </div>
    </div>
    <Panel title="Lender access" eyebrow="FACILITY GOVERNOR">
      <div className="row between"><p className="text-small muted">The governor approves wallets for new deposits.</p><Explorer address={facility.governor} /></div>
      {governor ? <div className="funding-form">
        <div className="fields">
          <label className="field">Lender wallet<input aria-label="Facility lender wallet" placeholder="0x…" value={lender} maxLength={42}
            onChange={(event) => { setLender(event.target.value); setLenderError(""); }} /></label>
          <label className="field">Deposit permission<Select label="Facility lender permission" value={permission} onValueChange={setPermission}
            options={[{ value: "true", label: "Approved" }, { value: "false", label: "Not approved" }]} /></label>
        </div>
        <button className="button secondary" disabled={!writable} onClick={approveLender}>Review lender access</button>
        {lenderError && <p className="field-error" role="alert">{lenderError}</p>}
      </div> : <p className="text-small muted">Connect the governor wallet to manage lender access.</p>}
    </Panel>
  </section>;
}
