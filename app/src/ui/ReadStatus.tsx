import { RefreshCw } from "lucide-react";
import { useApp } from "./context";

export function ReadStatus() {
  const { snapshot, preview, loading, refresh } = useApp();
  if (!snapshot || preview) return null;
  return (
    <div className="data-status">
      <span>
        {loading ? "Refreshing…" : `Read at block ${snapshot.blockNumber}`} ·{" "}
        {new Date(snapshot.observedAt).toLocaleTimeString()}
      </span>
      <button onClick={() => void refresh()} aria-label="Refresh chain data" disabled={loading}>
        <RefreshCw size={12} />
      </button>
      {Date.now() - snapshot.observedAt > 120_000 && <strong>Data may be stale</strong>}
    </div>
  );
}
