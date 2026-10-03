import type { Platform } from "../chain/model";
import { money } from "./primitives";
export function SettlementWaterfall({ platform: p }: { platform: Platform }) {
  return (
    <div className="waterfall">
      <div>
        <span className="flow-number">01</span>
        <div>
          <strong>Platform cash</strong>
          <p>Available for this settlement</p>
        </div>
        <b>
          {money(p.cash)}
          <small>USDG</small>
        </b>
      </div>
      <div>
        <span className="flow-number">02</span>
        <div>
          <strong>Repay Lockgate first</strong>
          <p>Advance principal and fee owed</p>
        </div>
        <b>
          {money(p.settlement.repayFirst)}
          <small>USDG</small>
        </b>
      </div>
      <div>
        <span className="flow-number">03</span>
        <div>
          <strong>Pay the redemption queue</strong>
          <p>Whole requests that current cash can cover</p>
        </div>
        <b>
          {money(p.settlement.queuePayable)}
          <small>USDG</small>
        </b>
      </div>
      {p.settlement.queueShortfall > 0n && (
        <div className="notice warn">
          {money(p.settlement.queueShortfall)} USDG of queued NAV cannot be covered by the current settlement cash.
        </div>
      )}
    </div>
  );
}
