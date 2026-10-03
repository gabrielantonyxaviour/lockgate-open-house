import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { RefreshCw } from "lucide-react";
import { loadSnapshot, errorMessage } from "./chain/client";
import { connectWallet, subscribeWallet, switchNetwork, walletChainId } from "./chain/wallet";
import type { Action, Snapshot } from "./chain/model";
import { AppContext } from "./ui/context";
import { Shell } from "./ui/Shell";
import { useRoute } from "./ui/router";
import { previewSnapshot } from "./ui/preview";
import { Transaction, type Review } from "./ui/Transaction";
import { Guide } from "./ui/Guide";
import Overview from "./pages/Overview";
import Platforms, { PlatformDetail } from "./pages/Platforms";
import Positions from "./pages/Positions";
import Exit from "./pages/Exit";
import Activity, { AdvanceDetail } from "./pages/Activity";
import { Issuer, Operations } from "./pages/Workspaces";
import Capital from "./pages/Capital";
import Approvals from "./pages/Approvals";
import { Onboarding } from "./pages/Onboarding";
import { Integration } from "./pages/Integration";
import { Settings, loadPreferences } from "./pages/Settings";
import { Empty } from "./ui/primitives";
import { type NetworkId } from "./chain/networks";
import { NetworkUnavailable } from "./ui/NetworkUnavailable";
export default function App() {
  const route = useRoute();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkId>(() =>
    new URLSearchParams(location.search).get("network") === "42161" ? 42161 : 421614,
  );
  const [switching, setSwitching] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [preview, setPreview] = useState(() => new URLSearchParams(location.search).get("preview") === "1");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [guide, setGuide] = useState(false);
  const [, preferenceRevision] = useState(0);
  const requestId = useRef(0);
  const pendingReads = useRef(new Map<string, Promise<Snapshot>>());
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    if (selectedNetwork === 42161) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    if (preview) {
      setSnapshot(previewSnapshot());
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    try {
      const key = account || "observer";
      let pending = pendingReads.current.get(key);
      if (!pending) {
        pending = loadSnapshot(account).finally(() => pendingReads.current.delete(key));
        pendingReads.current.set(key, pending);
      }
      const result = await pending;
      if (id === requestId.current) {
        setSnapshot(result);
        setError("");
      }
    } catch (e) {
      if (id === requestId.current) setError(errorMessage(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [account, preview, selectedNetwork]);
  useEffect(() => {
    setSnapshot(null);
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      clearInterval(timer);
      requestId.current++;
    };
  }, [refresh]);
  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const address = await connectWallet();
      setAccount(address);
      setChainId(await walletChainId());
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  }, []);
  useEffect(() => {
    if (!account) return;
    try {
      return subscribeWallet(
        (items) => {
          setAccount(items[0]);
        },
        (id) => {
          setChainId(id);
        },
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [account]);
  useEffect(() => {
    const prefs = loadPreferences();
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.numberStyle = prefs.numberStyle;
    const changed = () => preferenceRevision((v) => v + 1);
    window.addEventListener("lockgate:preferences", changed);
    return () => window.removeEventListener("lockgate:preferences", changed);
  }, []);
  const openReview = (action: Action, title: string, description: string) => {
    if (preview) {
      setError("Transactions are disabled in layout preview.");
      return;
    }
    if (!account) {
      void connect();
      return;
    }
    setReview({ action, title, description, account });
  };
  const network = async (id: NetworkId = selectedNetwork) => {
    setSwitching(true);
    try {
      if (account) {
        await switchNetwork(id);
        setChainId(await walletChainId());
      }
      setSelectedNetwork(id);
      setPreview(false);
      setReview(null);
      setError("");
      const url = new URL(location.href);
      url.searchParams.delete("preview");
      url.searchParams.set("network", String(id));
      history.replaceState(null, "", url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSwitching(false);
    }
  };
  const togglePreview = () => {
    setPreview((p) => !p);
    setReview(null);
    setError("");
    const url = new URL(location.href);
    if (preview) url.searchParams.delete("preview");
    else url.searchParams.set("preview", "1");
    history.replaceState(null, "", url);
  };
  const [path, query = ""] = route.split("?");
  const segments = path.split("/").filter(Boolean);
  const utility = ["/onboarding", "/integration", "/settings", "/approvals"].includes(path);
  let content;
  if (selectedNetwork === 42161) content = <NetworkUnavailable onSepolia={() => void network(421614)} />;
  else if (!snapshot && !utility)
    content = loading ? (
      <div className="loading-state" role="status">
        <RefreshCw size={22} className="spin" />
        <h1>Reading the exit desk.</h1>
        <p>Fetching balances, terms, and permissions from Arbitrum Sepolia.</p>
      </div>
    ) : (
      <Empty
        title="Chain data unavailable"
        action={
          <button className="button" onClick={refresh}>
            Retry connection
          </button>
        }
      >
        No illustrative values replace live balances. You can use the labelled layout preview to review the screens.
      </Empty>
    );
  else
    switch (segments[0]) {
      case "overview":
        content = <Overview />;
        break;
      case "platforms":
        content = <Platforms />;
        break;
      case "platform":
        content = <PlatformDetail key={path} address={segments[1] || ""} />;
        break;
      case "positions":
        content = <Positions />;
        break;
      case "exit":
        content = <Exit key={route} address={segments[1] || ""} params={new URLSearchParams(query)} />;
        break;
      case "activity":
        content = <Activity />;
        break;
      case "advance":
        content = <AdvanceDetail id={segments[1] || ""} />;
        break;
      case "issuer":
        content = <Issuer />;
        break;
      case "operations":
        content = <Operations />;
        break;
      case "capital":
        content = <Capital />;
        break;
      case "approvals":
        content = <Approvals />;
        break;
      case "onboarding":
        content = <Onboarding />;
        break;
      case "integration":
        content = <Integration />;
        break;
      case "settings":
        content = (
          <Settings
            account={account}
            onGuide={() => setGuide(true)}
            onDisconnect={() => {
              setAccount(undefined);
              setChainId(undefined);
              setReview(null);
            }}
          />
        );
        break;
      default:
        content = (
          <Empty
            title="Screen not found"
            action={
              <a className="button" href="#/overview">
                Return to overview
              </a>
            }
          >
            Choose a screen from the navigation.
          </Empty>
        );
    }
  return (
    <AppContext.Provider value={{ snapshot, account, preview, loading, error, refresh, connect, review: openReview }}>
      <Shell
        route={path}
        account={account}
        preview={preview}
        onPreview={togglePreview}
        onConnect={connect}
        busy={connecting}
        onGuide={() => setGuide(true)}
        chainId={chainId}
        selectedNetwork={selectedNetwork}
        switching={switching || Boolean(review)}
        onSwitch={network}
      >
        {error && (
          <div className="notice error global-notice" role="alert">
            {error}
            <button className="button secondary" onClick={refresh}>
              Retry
            </button>
          </div>
        )}
        {snapshot && !preview && (
          <div className="data-status">
            <span>
              {loading ? "Refreshing…" : `Read at block ${snapshot.blockNumber}`} ·{" "}
              {new Date(snapshot.observedAt).toLocaleTimeString()}
            </span>
            <button onClick={refresh} aria-label="Refresh chain data" disabled={loading}>
              <RefreshCw size={12} />
            </button>
            {Date.now() - snapshot.observedAt > 120_000 && <strong>Data may be stale</strong>}
          </div>
        )}
        {content}
      </Shell>
      {guide && <Guide onClose={() => setGuide(false)} />}{" "}
      {review && <Transaction review={review} onClose={() => setReview(null)} />}
    </AppContext.Provider>
  );
}
