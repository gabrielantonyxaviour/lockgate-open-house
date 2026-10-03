import { ArrowRight, Building2, Wallet } from "lucide-react";
import { useState } from "react";
import "../ui/entry.css";

export default function Welcome() {
  const [lastRole] = useState(() => {
    try {
      const raw = localStorage.getItem("lockgate.journey.v1");
      if (!raw || raw.length > 100) return null;
      const value = JSON.parse(raw);
      return value?.version === 1 && (value.role === "investor" || value.role === "issuer")
        ? (value.role as "investor" | "issuer")
        : null;
    } catch {
      return null;
    }
  });
  return (
    <div className="entry-welcome">
      <div className="entry-welcome-content">
        <div className="entry-intro">
          <span className="eyebrow">THE EARLY EXIT RAIL</span>
          <h1>Capital shouldn’t have to wait.</h1>
          <p>
            Investors can review an earlier exit. Platforms can fund it with a credit line and repay at settlement. Choose where
            you’d like to start.
          </p>
        </div>
        <div className="entry-choices">
          <a className="entry-choice" href="#/start/investor">
            <Wallet size={24} strokeWidth={1.3} aria-hidden="true" />
            <span className="eyebrow">FOR INVESTORS</span>
            <h2>I want an earlier exit.</h2>
            <p>Find your position, compare waiting with exiting now, and review the exact payout before confirming.</p>
            <span className="entry-choice-action">
              Explore my exit <ArrowRight size={16} />
            </span>
          </a>
          <a className="entry-choice" href="#/start/issuer">
            <Building2 size={24} strokeWidth={1.3} aria-hidden="true" />
            <span className="eyebrow">FOR PLATFORMS</span>
            <h2>I want to offer earlier exits.</h2>
            <p>Manage your facility, understand settlement demand, and give investors another way to access their capital.</p>
            <span className="entry-choice-action">
              Open my platform <ArrowRight size={16} />
            </span>
          </a>
        </div>
        <div className="entry-secondary">
          <a href="#/capital">
            Providing capital? <ArrowRight size={12} />
          </a>
          <a href="#/judge">
            Reviewing Lockgate? <ArrowRight size={12} />
          </a>
        </div>
        <p className="entry-footnote">Your wallet is connected. Review the terms before authorizing any transaction.</p>
      </div>
      {lastRole && (
        <p className="entry-footnote">
          <a className="inline-link" href={`#/start/${lastRole}`}>
            Continue your {lastRole === "investor" ? "investor" : "platform"} journey <ArrowRight size={12} />
          </a>
        </p>
      )}
    </div>
  );
}
