# SUMMARY

Local Anvil only (chain 31337, `http://127.0.0.1:8545`). Deploys stage 1, two partner vaults, and the stage-3 facility, and drives quotes and proposals through `engine/src/cli.ts`. The last run is `output.json`.

# PROGRESS

- 2026-10-02: `npm test` (3 tests) and `npm run e2e` both exited 0 against the shared Anvil (chain 31337). `PricingEngine.feeBps` at exactly 600 seconds returned 99 bps. The draw charged the fee for `dueAt - drawnAt`, which was 98 bps on this run: fee 98e6 on 10,000e6, investor paid 9,902e6, outstanding 0, earned fees 98e6. The engine quote on that clock was 101 bps. Stage 2 calls `propose --rpc`, which reads the vault and will not sign a mandate that disagrees with it. Harbour executed the signature. Keppel used `submitProposal` (no cash moved) and then `approve`. Lockgate's `approve` reverted. Harbour idle after repay was 80,101e6. Keppel's advance stayed open at 9,899e6. Router balance 0. Lockgate balance 0. A gated propose with `--sign-env` returns `signature: null`. The facility governor is not the borrower. Available draw 600,000e6, then senior principal went from 500,000e6 to 400,000e6 after junior was exhausted. `CreditLineBook` matched the repaid stage-1 line.

# Run

Anvil must already be the shared process on port 8545. This script does not start, reset, or kill it.

```
cd lockgate/repo/e2e
npm install
npm test
npm run e2e
```

Artifacts come from `contracts/out` after `forge build`. A failure writes `{ "error", "code" }` to stderr and exits 1. The signer is Anvil account 3, the public development key, passed to the engine as `LOCKGATE_PROPOSER_KEY`.
