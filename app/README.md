# Lockgate four-persona demo

The local app now implements the approved four-persona journey. Public liquidity metrics precede wallet connection. Signed wallet authentication retrieves a persisted profile; new wallets choose a path, while completed identities return to their workspace.

| Path | Entry | Working demo |
|---|---|---|
| 01 Exit investor | Get Started | TEST identity, matched positions, firm offers, exact exit agreement, signed settlement, payout and remaining position |
| 02 Originating fund/platform | Talk to us | Durable enquiry; invited organization wallet registers claims and settles collections/borrower repayments |
| 03 Investment firm | Talk to us | Durable enquiry; invited manager wallet configures whitelists, routes, limits and current-NAV exposure caps, views capital and processes withdrawals |
| 04 Capital provider | Get Started | TEST identity, one vehicle, vehicle eligibility, amount-specific subscription and firm acceptance, token approval/deposit, individual ledger and withdrawals |

Institutional activation is managed; choosing a role or submitting a form does not create licensing or wallet authority. The demo fixtures are fictional. No prospect is represented as an integrated fund.

## Local runtime

Follow [DEMO_RUNTIME.md](../docs/DEMO_RUNTIME.md) to start the isolated local chain, seed and API. The frontend runs at http://127.0.0.1:5197; Vite proxies `/api/demo` to loopback port8788. Do not restart another session's development server.

```sh
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
LOCKGATE_DEMO_E2E=1 npm run test:e2e -- test/demo-signed-flow.spec.ts --workers=1
```

The chain uses ID421614 for the demo contract guards but is a **local EVM**, not public Arbitrum Sepolia. Its token is a locally deployed six-decimal TEST ERC20, not Paxos-issued USDG. The gateway compares the wallet's genesis block with the configured RPC before signatures or transactions, preventing a public Sepolia wallet from accidentally sending to local addresses. Arbitrum One remains unavailable for financial actions until an approved deployment exists.

The current work is local only. Existing public Sepolia deployment history remains in [DEPLOYMENTS.md](../docs/DEPLOYMENTS.md); it does not prove these new contracts or journeys were deployed. No production domain or mainnet changes are included.

## Transaction and record boundaries

- Browser actions use the connected EIP1193 account. No private key is bundled in the frontend.
- Wallet-signed authentication is nonce-scoped; financial approvals and transactions require separate wallet confirmations.
- Selecting a TEST identity requests a reviewer attestation; the actual wallet binds it on chain. Original holding identity stays immutable.
- Wrong-owner fixtures reveal no private position metadata and cannot request offers. Empty holdings are distinct from failed reads.
- Firm quotes are indicative until the selected offer reserves actual cash and holding units. The investor signs its exact EIP712 quote and agreement hash; settlement rechecks identity, route, limits, expiry and reservation.
- Route A records acquired claim rights. Route B discharges the agreed old slice and records separate originator debt. The investor is not the borrower.
- Provider interests are individual, nontransferable bookkeeping entries. There is no pooled vault token, provider-selected exit allocation or custom lock switch.
- Receipts require successful EVM execution. Submitted hashes survive uncertainty and block another financial action until reconciled. Local hashes are not linked to a public explorer.
- Withdrawals use available cash or FIFO queueing; unfilled portions can be cancelled, filled cash claimed. Queued cash cannot fund another exit.
- Enquiries persist before acknowledgement. Branded HTML/text email stays queued without a verified Lockgate sender; provider acceptance is distinct from inbox delivery.

The chain contract and accounting limitations are documented in [DEMO_CHAIN_CONTRACT.md](../docs/DEMO_CHAIN_CONTRACT.md). Tests use real local signatures and raw broadcasts through an injected EIP1193 test wallet; that is not evidence of a browser extension's popup or public-network broadcasts.

## Design and scope

Compact headings, custom Radix selectors, shared radii, visible wallet balances, standalone `/#/terms`, `/#/records`, and a transaction-backed Demo sheet implement the reviewed design. The existing product blueprint remains the decision history; its preview is illustrative and cannot replace chain evidence.

Historical owner-funded rails and their source/tests remain available in the repository. The current App entry uses the new isolated demo sidecar. Production KYC, commercial KYB/licensing, external fund registrar integrations, governed lost-wallet recovery, multi-firm syndication and mainnet release are not claimed by this local demo.
