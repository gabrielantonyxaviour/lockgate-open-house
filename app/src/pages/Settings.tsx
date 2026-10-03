import { Select } from "../ui/Select";
import { useApp } from "../ui/context";
import { useState } from "react";
import { z } from "zod";
import { Badge, PageHead, Panel } from "../ui/primitives";

const preferenceKey = "lockgate.preferences.v1";
const preferenceSchema = z
  .object({ version: z.literal(1), density: z.enum(["comfortable", "compact"]), numberStyle: z.enum(["grouped", "plain"]) })
  .strict();
type Preferences = z.infer<typeof preferenceSchema>;
const defaults: Preferences = { version: 1, density: "comfortable", numberStyle: "grouped" };
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(preferenceKey);
    if (!raw || raw.length > 256) return defaults;
    const parsed = preferenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}

export function Settings({
  account,
  onGuide,
  onDisconnect,
}: {
  account?: string;
  onGuide: () => void;
  onDisconnect: () => void;
}) {
  const { snapshot } = useApp();
  const [preferences, setPreferences] = useState(loadPreferences);
  const [message, setMessage] = useState("");
  const update = (next: Preferences) => {
    const parsed = preferenceSchema.safeParse(next);
    if (!parsed.success) {
      setMessage("Choose a supported display preference.");
      return;
    }
    setPreferences(parsed.data);
    document.documentElement.dataset.density = next.density;
    document.documentElement.dataset.numberStyle = next.numberStyle;
    window.dispatchEvent(new CustomEvent("lockgate:preferences", { detail: parsed.data }));
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(parsed.data));
      setMessage("Preferences saved on this device.");
    } catch {
      setMessage("Preference changed for this visit; browser storage is unavailable.");
    }
  };
  return (
    <div className="stack">
      <PageHead
        eyebrow="SETTINGS & HELP"
        title="Your workspace, your controls."
        description="Manage this browser’s preferences and wallet connection."
      />
      <div className="grid-two">
        <Panel title="Wallet & network">
          {snapshot?.roles.operator && <a className="inline-link" href="#/operations">Open Lockgate operations</a>}
          <div className="stack">
            <Badge tone={account ? "good" : "muted"}>{account ? "Wallet connected" : "Read-only access"}</Badge>
            <dl className="key-values">
              <div>
                <dt>Wallet</dt>
                <dd className="mono">{account || "No wallet connected"}</dd>
              </div>
              <div>
                <dt>Supported networks</dt>
                <dd>Arbitrum One · 42161 / Arbitrum Sepolia · 421614</dd>
              </div>
            </dl>
            <p className="muted">
              A connected wallet does not grant issuer, operator, or partner permissions. The contracts verify the signer for each
              action.
            </p>
            {account && (
              <button className="button secondary" onClick={onDisconnect}>
                Disconnect from app
              </button>
            )}
          </div>
        </Panel>
        <Panel title="Display preferences">
          <div className="stack">
            <label className="field">
              Table spacing
              <Select
                label="Table spacing"
                value={preferences.density}
                onValueChange={(value) => update({ ...preferences, density: value as Preferences["density"] })}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            </label>
            <label className="field">
              Number display
              <Select
                label="Number display"
                value={preferences.numberStyle}
                onValueChange={(value) => update({ ...preferences, numberStyle: value as Preferences["numberStyle"] })}
                options={[
                  { value: "grouped", label: "Grouped · 1,000.00" },
                  { value: "plain", label: "Plain · 1000.00" },
                ]}
              />
            </label>
            <p className="muted" role="status" aria-live="polite">
              {message || "Preferences are stored on this device."}
            </p>
          </div>
        </Panel>
      </div>
      <div className="grid-two">
        <Panel title="Explore with a guide">
          <p>Follow the judge checklist through the actual app. You can pause, ignore, or reopen it at any time.</p>
          <button className="button" onClick={onGuide}>
            Open judge guide
          </button>
        </Panel>
        <Panel title="Understanding an exit">
          <div className="stack">
            <details>
              <summary>What is the exit fee?</summary>
              <p>
                The quote shows the fee and USDG payout before confirmation. A later quote may differ if time, NAV, capacity, or
                facility terms change.
              </p>
            </details>
            <details>
              <summary>Does the reserve guarantee repayment?</summary>
              <p>
                No. A platform reserve can cover losses only up to its available balance. Uncovered exposure can remain after it
                is used.
              </p>
            </details>
            <details>
              <summary>What does disconnecting do?</summary>
              <p>
                It removes this app’s active wallet connection. It does not revoke token approvals or change existing on-chain
                positions.
              </p>
            </details>
          </div>
        </Panel>
      </div>
    </div>
  );
}
