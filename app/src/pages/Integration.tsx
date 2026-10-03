import { ArbitrumMark, UsdgMark, PaxosBrand } from "../ui/Brand";
import { Badge, PageHead, Panel } from "../ui/primitives";

const contracts = [
  ["USDG", "0xFFC95faa3d63Cde504a05B567C600B78C0b41892", "Paxos USDG · 6 decimals"],
  ["Credit line", "0xd80B6cD54Af98eEc49300259762c483d60F90111", "Lockgate capital and platform advances"],
  ["Platform reserve", "0xC5865AC922aCDA1C13fD06aF5b66CFfA6eAA333D", "Platform-specific loss buffer"],
  ["Weekly platform", "0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25", "Investor positions and redemption queue"],
  ["Fund factory", "0x0f70e5Eeb646D60d104Be26ef5130926fDdAaBbA", "Owner-authorized platform creation"],
  ["Partner router", "0x9646c780e728C498f375768957330C50406E3370", "Partner-vault quote routing"],
  ["Partner vault A", "0xDa1AB87bC22730f21EC60F4B53f2271b95B6bAfb", "Segregated partner-controlled capital"],
  ["Partner vault B", "0xb2D6e88e71341B9aa415F9cA0E2Eb98F9a0FdaB1", "Segregated partner-controlled capital"],
  ["Credit facility", "0x051Aca84903701E93AA387d6Dd554aF79D640e60", "Senior/junior facility against Lockgate’s book"],
] as const;
const lifecycle = [
  ["Quote", "The platform quotes a NAV value, fee, and payout. Capacity and eligibility are checked against the facility."],
  [
    "Exit",
    "The investor authorizes the exit. The platform draws USDG and pays the investor; Lockgate does not buy the investor’s position.",
  ],
  [
    "Settle",
    "Platform cash repays Lockgate first, then pays the remaining redemption queue. A cash shortfall does not roll the window.",
  ],
  [
    "Recover",
    "After the configured grace period, late repayment can use available platform reserve. Uncovered exposure remains a loss risk.",
  ],
] as const;

export function Integration() {
  return (
    <div className="stack integration-content">
      <PageHead
        eyebrow="INTEGRATION"
        title="One rail. Clear responsibilities."
        description="Contract roles, settlement mechanics, and the deployed system."
        action={<Badge tone="warn">Arbitrum Sepolia</Badge>}
      />
      <div className="notice">
        These are the recorded 2 October 2026 deployment addresses. Balances and operating status are read separately from chain.
      </div>
      <Panel title="Network & settlement asset">
        <div className="grid-two">
          <div className="stack">
            <div className="brand-asset">
              <ArbitrumMark />
              <strong>Arbitrum</strong>
            </div>
            <p>Contracts are deployed on Arbitrum Sepolia. Arbitrum One is not yet available.</p>
          </div>
          <div className="stack">
            <div className="brand-credits">
              <span className="brand-asset">
                <UsdgMark />
                <strong>Global Dollar · USDG</strong>
              </span>
              <PaxosBrand />
            </div>
            <p>USDG is the settlement asset for deposits, early exits, and platform repayment.</p>
          </div>
        </div>
      </Panel>
      <div className="grid-two">
        <Panel title="Platform integration">
          <div className="stack">
            {lifecycle.map(([title, body], index) => (
              <div key={title}>
                <p className="muted">
                  0{index + 1} / {title}
                </p>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </Panel>
        <div className="stack">
          <Panel title="Who authorizes what">
            <dl className="key-values">
              <div>
                <dt>Investor</dt>
                <dd>Own redemption request and exit, including minimum received.</dd>
              </div>
              <div>
                <dt>Issuer</dt>
                <dd>Platform NAV, eligibility, and redemption gating.</dd>
              </div>
              <div>
                <dt>Lockgate owner</dt>
                <dd>Platform registration, facility limits, and owned line capital.</dd>
              </div>
              <div>
                <dt>Partner</dt>
                <dd>Its vault capital, mandate, and proposal approval.</dd>
              </div>
              <div>
                <dt>Window processing</dt>
                <dd>Callable once eligible; contract repayment rules still apply.</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Before a real platform goes live">
            <p>
              Agree repayment priority and facility terms, establish legal eligibility, fund the reserve, implement the platform
              adapter, and test failure paths. Contract ordering here does not establish legal priority at an external platform.
            </p>
            <p className="muted">
              The open-token buy-and-redeem route is not deployed. There is no public retail lending pool in this experience.
            </p>
          </Panel>
        </div>
      </div>
      <Panel title="Deployed contracts">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Role</th>
                <th scope="col">Explorer address</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(([name, address, role]) => (
                <tr key={address}>
                  <th scope="row" data-label="Contract">{name}</th>
                  <td data-label="Role">{role}</td>
                  <td data-label="Explorer address">
                    <a className="mono" href={`https://sepolia.arbiscan.io/address/${address}`} target="_blank" rel="noreferrer">
                      {address}
                      <span className="muted"> ↗</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Partner-backed exits">
        <p>
          A partner vault requires an authorized Lockgate proposal and partner approval. The signed terms bind the platform,
          recipient, amount, payout, fee, due date, expiry, nonce, and quote reference. A proposal is not permission to move
          partner capital.
        </p>
        <p className="muted">
          Each vault owns its capital separately. Reserve coverage is limited to the amount available; it is not a repayment
          guarantee.
        </p>
      </Panel>
    </div>
  );
}
