import { useState } from "react";
import { parseAmount } from "../chain/amounts";
import type { PartnerVault } from "../chain/model";
import { useApp } from "../ui/context";
import { Badge, Explorer, Panel, date, money } from "../ui/primitives";
import { Select } from "../ui/Select";

export default function PartnerOperations({ vault }: { vault: PartnerVault }) {
  const { snapshot, account, connect, review, preview } = useApp();
  const [platformValue, setPlatform] = useState("");
  const [advanceValue, setAdvance] = useState("");
  const [reserveAmount, setReserveAmount] = useState("");
  const [error, setError] = useState("");
  const platforms = vault.platformTerms?.filter((item) => item.approved) ?? [];
  const platform = platforms.find((item) => item.platform === platformValue) ?? platforms[0];
  const advances = vault.advances?.filter((item) => item.owed > 0n && (item.status === 1 || item.status === 3)) ?? [];
  const advance = advances.find((item) => String(item.id) === advanceValue) ?? advances[0];
  const lateAfter = advance?.grace === undefined ? undefined : advance.dueAt + advance.grace;
  const lateEligible = advance?.status === 1 && lateAfter !== undefined && BigInt(Math.floor((snapshot?.observedAt ?? Date.now()) / 1000)) >= lateAfter;
  const postReserve = () => {
    if (!account) { void connect(); return; }
    if (!platform) return;
    try {
      parseAmount(reserveAmount);
      review({ kind: "vaultPostReserve", vault: vault.address, platform: platform.platform, amount: reserveAmount },
        "Post partner reserve", "Transfer USDG into this platform’s reserve in the partner vault. Reserve funds do not become idle lending capital.");
      setError("");
    } catch { setError("Enter a positive USDG amount with up to 6 decimals."); }
  };
  return <Panel title="Reserve & repayment" eyebrow="PARTNER ADVANCES">
    <div className="grid-two grid-equal">
      <div>
        <h3>Platform reserve</h3>
        <p className="text-small muted partner-operation-note">Any funded wallet can post reserve. The balance covers this platform’s late advances.</p>
        {platform ? <div className="stack">
          <label className="field">Platform<Select label="Partner reserve platform" value={platform.platform} onValueChange={setPlatform}
            options={platforms.map((item) => ({ value: item.platform, label: snapshot?.platforms.find((p) => p.address.toLowerCase() === item.platform.toLowerCase())?.name ?? item.platform }))} /></label>
          <dl className="key-values">
            <div><dt>Posted reserve</dt><dd>{money(platform.reserve)} USDG</dd></div>
            <div><dt>Platform exposure</dt><dd>{money(platform.exposure)} USDG</dd></div>
          </dl>
          <label className="field">Reserve amount · USDG<input aria-label="Partner reserve amount" inputMode="decimal" placeholder="0.00" value={reserveAmount}
            onChange={(event) => { setReserveAmount(event.target.value); setError(""); }} /></label>
          <button className="button secondary" disabled={preview} onClick={postReserve}>{account ? "Review partner reserve" : "Connect wallet"}</button>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div> : <div className="notice">The vault owner must approve a platform before it can receive reserve.</div>}
      </div>
      <div>
        <h3>Advance repayment</h3>
        <p className="text-small muted partner-operation-note">Any funded wallet can repay an advance. The amount includes remaining principal and fees.</p>
        {advance ? <div className="stack">
          <label className="field">Advance<Select label="Partner advance" value={String(advance.id)} onValueChange={setAdvance}
            options={advances.map((item) => ({ value: String(item.id), label: `Advance #${item.id} · ${money(item.owed)} USDG` }))} /></label>
          <dl className="key-values">
            <div><dt>Platform</dt><dd><Explorer address={advance.platform} /></dd></div>
            <div><dt>Remaining owed</dt><dd>{money(advance.owed)} USDG</dd></div>
            <div><dt>Due</dt><dd>{date(advance.dueAt)}</dd></div>
            <div><dt>Status</dt><dd><Badge tone={advance.status === 3 ? "warn" : "muted"}>{advance.status === 3 ? "Late" : "Active"}</Badge></dd></div>
          </dl>
          <div className="row">
            <button className="button secondary" disabled={preview} onClick={() => account
              ? review({ kind: "vaultRepay", vault: vault.address, advanceId: advance.id }, "Repay partner advance", "Transfer the exact remaining principal and fee from your wallet to this partner vault.")
              : connect()}>{account ? "Repay partner advance" : "Connect wallet"}</button>
            <button className="button secondary" disabled={preview || !account || !lateEligible}
              onClick={() => review({ kind: "vaultMarkLate", vault: vault.address, advanceId: advance.id }, "Mark partner advance late", "Apply available platform reserve to the overdue advance. Any remaining shortfall stays outstanding.")}>Mark partner advance late</button>
          </div>
          {advance.status === 1 && <p className="text-small muted">{lateAfter !== undefined ? `Reserve recovery becomes available ${date(lateAfter)}.` : "Refresh chain data to check the grace period."}</p>}
        </div> : <div className="notice">No partner advances are awaiting repayment.</div>}
      </div>
    </div>
  </Panel>;
}
