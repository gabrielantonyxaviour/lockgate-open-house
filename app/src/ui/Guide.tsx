import { X, ArrowRight, Pause } from "lucide-react";
import { CheckRow } from "./primitives";
import { useApp } from "./context";
import { go } from "./router";
export function Guide({ onClose }: { onClose: () => void }) {
  const { snapshot, account } = useApp();
  const own = snapshot?.creditLine.advances.filter((a) => a.to.toLowerCase() === account?.toLowerCase()) || [];
  const steps = [
    { text: "Connect a wallet on Arbitrum Sepolia", done: Boolean(account), path: "/settings" },
    { text: "Explore a platform and its terms", done: false, path: "/platforms" },
    {
      text: "Fund a position with USDG",
      done: Boolean(snapshot?.platforms.some((p) => p.holding > 0n)),
      path: "/positions",
    },
    { text: "Review a live quote and exit today", done: own.length > 0, path: "/positions" },
    { text: "Inspect the platform repayment", done: own.some((a) => a.status === "Repaid"), path: "/activity" },
  ];
  return (
    <aside className="guide-panel" aria-label="Judge guide">
      <div className="guide-top">
        <span className="eyebrow">OPTIONAL WALKTHROUGH</span>
        <button className="icon-button" aria-label="Close judge guide" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <h2>One exit. The full cycle.</h2>
      <p>
        Use your own amounts and wallet. This checklist follows real contract state; completing it does not require a scripted
        path.
      </p>
      {steps.map((s) => (
        <a href={`#${s.path}`} key={s.text}>
          <CheckRow done={s.done}>{s.text}</CheckRow>
        </a>
      ))}
      <p className="text-small">
        You’ll need USDG and Sepolia ETH for gas. Platform creation is restricted to Lockgate; use the deployed platform.
      </p>
      <div className="row between">
        <button className="button secondary" onClick={onClose}>
          <Pause size={12} /> Pause guide
        </button>
        <button className="button" onClick={() => go("/platforms")}>
          Explore <ArrowRight size={13} />
        </button>
      </div>
    </aside>
  );
}
