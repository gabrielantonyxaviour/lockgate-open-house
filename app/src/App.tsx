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
import { loadPreferences } from "./pages/Settings";
import { AppRoutes } from "./ui/AppRoutes";
import { EntryFrame } from "./ui/EntryFrame";
import { go } from "./ui/router";
import { type NetworkId } from "./chain/networks";
import { useInputModality } from "./ui/input-modality";
export default function App() {
  useInputModality();
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
      if ((location.hash.slice(1) || location.pathname || "/") === "/") go("/choose");
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
  const path = route.split("?")[0];
  const Frame = (!account && !preview) || (path === "/" || path === "/choose") || path.startsWith("/start/") || path === "/judge" ? EntryFrame : Shell;
  return (
    <AppContext.Provider value={{ snapshot, account, preview, loading, error, refresh, connect, review: openReview }}>
      <Frame
        route={path}
        account={account}
        preview={preview}
        onPreview={togglePreview}
        onConnect={connect}
        busy={connecting}
        onGuide={() => go("/judge")}
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
        {snapshot && !preview && path !== "/" && (
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
        <AppRoutes
          route={route}
          account={account}
          networkId={selectedNetwork}
          onSepolia={() => void network(421614)}
          onDisconnect={() => {
            setAccount(undefined);
            setChainId(undefined);
            setReview(null);
          }}
        />
      </Frame>
      {review && <Transaction review={review} onClose={() => setReview(null)} />}
    </AppContext.Provider>
  );
}
