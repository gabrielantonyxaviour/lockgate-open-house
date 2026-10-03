import { NAV } from "./navigation";
import { ScreenSearch } from "./ScreenSearch";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { Menu, X, Search, ArrowRight, ArrowUpRight, Wallet, BookOpen } from "lucide-react";
import { Select } from "./Select";
import { short } from "./primitives";
import { go } from "./router";
import { useDialog } from "./dialog";
import { type NetworkId, NETWORKS } from "../chain/networks";
import { ArbitrumMark, PaxosBrand, UsdgMark } from "./Brand";
export function Shell({
  children,
  route,
  account,
  onConnect,
  preview,
  onPreview,
  busy,
  chainId,
  selectedNetwork,
  switching,
  onSwitch,
}: {
  children: ReactNode;
  route: string;
  account?: string;
  onConnect: () => void;
  onGuide: () => void;
  preview: boolean;
  onPreview: () => void;
  busy: boolean;
  chainId?: number;
  selectedNetwork: NetworkId;
  switching: boolean;
  onSwitch: (id?: NetworkId) => void;
}) {
  const [menu, setMenu] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  useDialog(navRef, () => setMenu(false), false, menu);
  const [search, setSearch] = useState<string | null>(null);
  let lastJourney = "investor";
  try {
    const value = JSON.parse(localStorage.getItem("lockgate.journey.v1") || "null");
    if (value?.version === 1 && value.role === "issuer") lastJourney = "issuer";
  } catch {
    /* Use investor navigation for an unrecorded journey. */
  }
  const initialGroup = route.startsWith("/issuer")
    ? "issuer"
    : route.startsWith("/operations")
      ? "operations"
      : route.startsWith("/capital") || route.startsWith("/approvals")
        ? "partner"
        : lastJourney;
  const group = initialGroup;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k")) {
        e.preventDefault();
        setSearch("");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const title =
    NAV.find((n) => route.startsWith(n.path))?.label ||
    (route.startsWith("/exit") ? "Exit today" : route.startsWith("/advance") ? "Advance detail" : "Platform detail");
  return (
    <div className="app-shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside
        ref={navRef}
        role={menu ? "dialog" : undefined}
        aria-modal={menu ? true : undefined}
        aria-label={menu ? "Navigation menu" : undefined}
        className={`sidebar ${menu ? "open" : ""}`}
      >
        <a className="brand" href="#/overview">
          <img src="/mark.svg" alt="" />
          <span>lockgate</span>
          <span className="brand-dot">.</span>
        </a>
        <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMenu(false)}>
          <X size={16} />
        </button>
        <div className="workspace">
          <span className="eyebrow">{group === "investor" ? "YOUR EXIT DESK" : "YOUR WORKSPACE"}</span>
          <strong className="workspace-name">
            {group === "issuer"
              ? "Platform liquidity"
              : group === "partner"
                ? "Capital partner"
                : group === "operations"
                  ? "Lockgate operations"
                  : "Investor exit desk"}
          </strong>
          <a className="inline-link" href="#/choose">
            Change journey
          </a>
        </div>
        <button className="search-button" onClick={() => setSearch("")}>
          <Search size={14} /> Find a screen <kbd>/</kbd>
        </button>
        <nav aria-label="Main navigation">
          <span className="nav-label">{group === "investor" ? "YOUR EXIT DESK" : "WORKSPACE"}</span>
          {NAV.filter(
            (n) =>
              (n.group === group || n.path === "/platforms" || n.path === "/activity") &&
              !(group === "investor" && n.path === "/overview"),
          ).map((n) => (
            <a
              key={n.path}
              href={`#${n.path}`}
              className={`nav-item ${route.startsWith(n.path) ? "active" : ""}`}
              aria-current={route.startsWith(n.path) ? "page" : undefined}
              onClick={() => setMenu(false)}
            >
              <n.icon size={16} />
              {n.label}
            </a>
          ))}
          <span className="nav-label resources-label">RESOURCES</span>
          {NAV.filter((n) => n.group === "resources" && (group !== "investor" || n.path === "/settings")).map((n) => (
            <a
              key={n.path}
              className={`nav-item ${route === n.path ? "active" : ""}`}
              href={`#${n.path}`}
              onClick={() => setMenu(false)}
            >
              <n.icon size={16} />
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="guide-teaser">
            <BookOpen size={17} />
            <strong>Help when you need it.</strong>
            <p>Wallet connections, exits, and platform settlement.</p>
            <a className="inline-link" href="#/settings">
              Get help <ArrowRight size={13} />
            </a>
          </div>
          <a href="https://lockgate.finance" target="_blank" rel="noreferrer" className="site-link">
            About Lockgate <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      {menu && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
      <div className="app-body">
        <header className="topbar">
          <div className="row">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenu(true)}>
              <Menu size={16} />
            </button>
            <span className="breadcrumb">
              Exit desk <span>/</span> <strong>{title}</strong>
            </span>
          </div>
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
            <button
              className="button secondary wallet-button"
              onClick={account ? () => go("/settings") : onConnect}
              disabled={busy}
            >
              <Wallet size={14} />
              {account ? short(account) : busy ? "Connecting…" : "Connect wallet"}
            </button>
          </div>
        </header>
        {preview && (
          <div className="network-banner preview-banner">
            <span>Layout preview · Illustrative data · Transactions disabled</span>
            <button onClick={onPreview}>
              Return to chain data <ArrowRight size={12} />
            </button>
          </div>
        )}
        {account && chainId !== selectedNetwork && !preview && (
          <div className="wrong-network notice warn">
            Your wallet is on another network. Switch to {NETWORKS[selectedNetwork].name} to continue.
            <button className="button secondary" onClick={() => onSwitch()}>
              Switch network
            </button>
          </div>
        )}
        <main id="main" tabIndex={-1} className="main-content">
          {children}
        </main>
        <footer className="app-footer">
          <div className="brand-credits">
            <span className="brand-asset">
              <UsdgMark size={18} /> USDG
            </span>
            <span className="muted">issued by</span>
            <PaxosBrand width={70} />
          </div>
          <a href="#/integration">
            Contract addresses <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {NAV.filter((n) => ["/platforms", "/positions", "/activity"].includes(n.path)).map((n) => (
          <a href={`#${n.path}`} key={n.path} className={route.startsWith(n.path) ? "active" : ""}>
            <n.icon size={17} />
            <span>{n.path === "/positions" ? "My exits" : n.label}</span>
          </a>
        ))}
        <button onClick={() => setMenu(true)}>
          <Menu size={17} />
          <span>More</span>
        </button>
      </nav>
      {search !== null && <ScreenSearch search={search} onChange={setSearch} onClose={() => setSearch(null)} />}
    </div>
  );
}
