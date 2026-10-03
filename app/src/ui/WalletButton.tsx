import { useRef, useState } from "react";
import { Wallet, X, Copy, Check, LogOut, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";
import { useApp } from "./context";
import { useDialog } from "./dialog";
import { money, short } from "./primitives";
import { NETWORKS, type NetworkId } from "../chain/networks";

export function WalletButton({ account, busy, onConnect, chainId, selectedNetwork }: {
  account?: string; busy: boolean; onConnect: () => void; chainId?: number; selectedNetwork: NetworkId;
}) {
  const { snapshot, disconnect, preview } = useApp();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useDialog(dialog, () => setOpen(false), false, open);
  const matching = snapshot?.account?.toLowerCase() === account?.toLowerCase() && !preview;
  const network = chainId === 42161 || chainId === 421614 ? NETWORKS[chainId] : undefined;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account || "");
      setCopied(true);
      setCopyError("");
    } catch { setCopyError("Select and copy the address below."); }
  };
  return <>
    <button className="button secondary wallet-button" disabled={busy}
      aria-haspopup={account ? "dialog" : undefined} aria-expanded={account ? open : undefined}
      onClick={account ? () => { setOpen(true); setCopied(false); } : onConnect}>
      <Wallet size={14} />{account ? short(account) : busy ? "Connecting…" : "Connect wallet"}
    </button>
    {open && account && <div className="dialog-backdrop">
      <div ref={dialog} tabIndex={-1} className="transaction-dialog wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
        <div className="row between"><h2 id="wallet-title">Your wallet</h2>
          <button className="icon-button" aria-label="Close wallet" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
        <p className="wallet-address mono">{account}</p>
        <div className="row">
          <button className="button secondary" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Address copied" : "Copy address"}</button>
          {network && <a className="inline-link" href={`${network.explorerUrl}/address/${account}`} target="_blank" rel="noreferrer">View wallet <ExternalLink size={13} /></a>}
        </div>
        <dl className="key-values">
          <div><dt>Wallet network</dt><dd>{network?.name || (chainId ? `Chain ${chainId}` : "Checking…")}</dd></div>
          <div><dt>USDG · Arbitrum Sepolia</dt><dd>{matching && snapshot ? `${money(snapshot.usdgBalance)} USDG` : "—"}</dd></div>
          <div><dt>Gas · Arbitrum Sepolia</dt><dd>{matching && snapshot?.nativeBalance !== undefined ? `${Number(formatUnits(snapshot.nativeBalance, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH` : "—"}</dd></div>
        </dl>
        {chainId !== selectedNetwork && <div className="notice warn">Select {NETWORKS[selectedNetwork].name} in your wallet to transact.</div>}
        {matching && snapshot?.nativeBalance === 0n && <div className="notice warn">Add Sepolia ETH to pay network fees.</div>}
        {copyError && <p role="status">{copyError}</p>}
        <div className="row between wallet-dialog-actions">
          <a className="button secondary" href="#/settings" onClick={() => setOpen(false)}>Wallet settings</a>
          <button className="button secondary" onClick={() => { setOpen(false); disconnect?.(); }}><LogOut size={14} />Disconnect</button>
        </div>
      </div>
    </div>}
  </>;
}
