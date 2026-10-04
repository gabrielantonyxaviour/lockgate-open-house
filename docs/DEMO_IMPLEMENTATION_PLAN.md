# Four-persona demo implementation

Approved scope: local implementation first. No production deployment or mainnet writes.

## Acceptance

1. Wallet-signed authentication; wallet-scoped persisted role and identity; completed onboarding resumes correctly.
2. Exactly ten selectable TEST identity profiles; holding-owner mismatch never exposes private offers or settles; empty identity remains empty.
3. Five active TEST originating platforms and five active TEST firm vehicles, each seeded by real ERC20 deposit transactions.
4. 04 chooses one firm vehicle, checks eligibility, signs amount-specific terms, receives firm acceptance, approves/funds from connected wallet, sees individual book balance, income/loss and withdrawal/queue.
5. 01 discovers approved positions, selects amount, accepts permitted route/net payout, signs exact agreement, settles with connected wallet; holdings and cash reconcile against receipts.
6. 02 and 03 use managed enquiry/invitation, organization-wallet dashboards; register/repay and mandate/approve actions require their actual connected wallet.
7. Durable enquiry acknowledgement and branded email outbox; sent status requires actual provider delivery response, never an unsent HTML preview.
8. Demo sheet performs bounded issuance/faucet transactions; setup cannot grant institutional roles.
9. Failed/rejected wallet actions, changed account/network, expired quotes, duplicate/replay and unauthorized direct API calls fail safely.
10. Inspect 375/768/1440 layouts; record actual signed-wallet flows and receipt/balance evidence. Local EVM evidence is distinct from public Sepolia and browser extension popup evidence.

## Ownership

- Core: contracts/src/demo, contracts/test/demo, DEMO_CHAIN_CONTRACT.md.
- Runtime: harness/src/demo, scripts/demo, public manifest, DEMO_RUNTIME.md.
- UX: App.tsx, pages/ui/demo.
- Integration and verification: app/src/services, root-owned tests, runtime integration, evidence.
- Existing film session: video/storyboard; coordinator sends comments only.

## Demo film target: 240 seconds

| Time | Footage |
|---|---|
| 0–15 | Need for earlier liquidity; public app |
| 15–30 | Connect wallet; four entry paths |
| 30–80 | 04 identity, chosen vehicle, exact signed subscription, real funding |
| 80–150 | 01 identity match, position, quote, agreement, payout receipt |
| 150–180 | 02 originating-platform dashboard and repayment |
| 180–210 | 03 firm mandate and allocation controls |
| 210–230 | 04 proceeds/withdrawal and matching receipts |
| 230–240 | Environment and pre-mainnet commitments |

Capture order can differ from edit order. Use the same vehicle/deal and actual values throughout. Both purchase and debtor-financing routes need full QA; choose one hero route for the short film. Institutional KYB remains managed onboarding, not an automatic license granted by software. Full QA recordings supplement the edited film.
