import { ArrowRight } from "lucide-react";
import { ArbitrumMark } from "./Brand";
import { PageHead, Panel } from "./primitives";
export function NetworkUnavailable({ onSepolia }: { onSepolia: () => void }) {
  return (
    <div className="stack">
      <PageHead
        eyebrow="ARBITRUM ONE"
        title="The exit desk is coming to Arbitrum One."
        description="Contract addresses are not configured on this network yet."
      />
      <Panel title="No deployed desk configured">
        <div className="stack">
          <div className="brand-asset">
            <ArbitrumMark />
            <strong>Arbitrum One · 42161</strong>
          </div>
          <p>Your network selection is active. Choose Arbitrum Sepolia to use the deployed exit desk.</p>
          <div>
            <button className="button" onClick={onSepolia}>
              Open Arbitrum Sepolia <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
