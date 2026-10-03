import type { ComponentProps } from "react";
import type { Shell } from "./Shell";
import { Select } from "./Select";
import { NETWORKS, type NetworkId } from "../chain/networks";
import { ArbitrumMark, UsdgMark, PaxosBrand } from "./Brand";
import { WalletButton } from "./WalletButton";
import { ArrowLeft } from "lucide-react";
export function EntryFrame({
  children,
  route,
  account,
  onConnect,
  busy,
  selectedNetwork,
  onSwitch,
  switching,
  preview,
  onPreview,
  chainId,
}: ComponentProps<typeof Shell>) {
  return (
    <div className="entry-frame">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar entry-topbar">
        <a className="brand" href="#/">
          <img src="/mark.svg" alt="" />
          <span>lockgate</span>
          <span className="brand-dot">.</span>
        </a>
        <div className="row topbar-actions">
          <Select
            label="Network"
            className="network-select"
            value={String(selectedNetwork)}
            disabled={switching}
            onValueChange={(value) => onSwitch(Number(value) as NetworkId)}
            options={Object.values(NETWORKS).map((network) => ({
              value: String(network.id),
              label: network.name,
              icon: <ArbitrumMark />,
            }))}
          />
          <WalletButton account={account} busy={busy} onConnect={onConnect} chainId={chainId} selectedNetwork={selectedNetwork} />
        </div>
      </header>
      {preview && (
        <div className="network-banner preview-banner">
          <span>Layout preview · Illustrative data · Transactions disabled</span>
          <button onClick={onPreview}>Return to chain data</button>
        </div>
      )}
      {account && chainId !== selectedNetwork && !preview && (
        <div className="notice warn">
          <span>Your wallet is on another network.</span>
          <button className="button secondary" onClick={() => onSwitch()}>
            Switch to {NETWORKS[selectedNetwork].name}
          </button>
        </div>
      )}
      <main id="main" tabIndex={-1} className="entry-main">
        {route !== "/" && (
          <a className="inline-link entry-back" href={account ? "#/choose" : "#/"}>
            <ArrowLeft size={14} /> {account ? "Change journey" : "Back to overview"}
          </a>
        )}
        {children}
      </main>
      <footer className="app-footer">
        <div className="brand-credits">
          <span className="brand-asset">
            <UsdgMark size={18} /> USDG
          </span>
          <span>issued by</span>
          <PaxosBrand width={70} />
        </div>
        <a href="#/integration">Contract addresses</a>
      </footer>
    </div>
  );
}
