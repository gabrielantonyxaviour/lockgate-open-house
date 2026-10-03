import { Select } from "../ui/Select";
import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { loadEvents, type EventResult } from "../chain/events";
import { errorMessage } from "../chain/client";
import { useApp } from "../ui/context";
import { Panel, Empty, Badge, Explorer } from "../ui/primitives";

export function RecentEvents() {
  const { preview } = useApp();
  const [result, setResult] = useState<EventResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState("all");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setResult(null);
    setError("");
    if (preview) return;
    setLoading(true);
    loadEvents()
      .then((value) => {
        if (current) setResult(value);
      })
      .catch((reason) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [preview, version]);
  const events = result?.events.filter((event) => kind === "all" || event.kind === kind) || [];
  return (
    <Panel title="Recent chain activity" eyebrow="EXITS / REPAYMENTS / RESERVES / PARTNERS">
      <div className="filter-bar">
        <Select
          label="Activity category"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "all", label: "All events" },
            { value: "exit", label: "Investor exits" },
            { value: "repayment", label: "Repayments" },
            { value: "reserve", label: "Reserve movements" },
            { value: "partner", label: "Partner actions" },
            { value: "control", label: "Platform & capital controls" },
          ]}
        />
        <button
          className="icon-button"
          aria-label="Refresh activity"
          onClick={() => setVersion((value) => value + 1)}
          disabled={preview || loading}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {preview ? (
        <Empty title="Chain events available in live mode">Illustrative preview does not create transaction history.</Empty>
      ) : loading ? (
        <p className="text-small muted" role="status">
          Reading recent contract events…
        </p>
      ) : error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : !events.length ? (
        <Empty title="No events in this recent range">
          The advance ledger above still shows all loaded advances. Broader history needs an indexed event service.
        </Empty>
      ) : (
        <ol className="event-feed">
          {events.map((event) => (
            <li key={event.id}>
              <div className="event-marker">
                <ArrowUpRight size={14} />
              </div>
              <div className="event-body">
                <strong>{event.description}</strong>
                <div className="row">
                  <Badge>{event.kind}</Badge>
                  <span className="mono muted">Block {String(event.blockNumber)}</span>
                  <Explorer hash={event.hash}>Transaction</Explorer>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {result && (
        <p className="text-small muted">
          Recent blocks {String(result.fromBlock)}–{String(result.toBlock)} · newest 100 matching events at most.
        </p>
      )}
      {result?.warnings.map((warning) => (
        <div className="notice warn" key={warning}>
          {warning}
        </div>
      ))}
    </Panel>
  );
}
