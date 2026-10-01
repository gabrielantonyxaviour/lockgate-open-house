# SUMMARY

Local Anvil only (chain 31337, `http://127.0.0.1:8545`). Deploys stage 1, two partner vaults, and the stage-3 facility, and drives quotes and proposals through `engine/src/cli.ts`. The last run is `output.json`.

# PROGRESS

- 2026-10-02: `npm run e2e` exited 0 against the shared Anvil. Stage 1 chain quote 99 bps, fee 99e6 on 10,000e6, investor paid 9,901e6, outstanding 0, earned fees 99e6. Engine quote on the same clock was 101 bps. Both partner vaults executed that `LockgateAdvance` signature. Harbour idle after repay was 80,101e6. Keppel's advance stayed open at 9,899e6. Router balance 0. Lockgate balance 0. Facility available draw 600,000e6, then senior principal went from 500,000e6 to 400,000e6 after junior was exhausted. `CreditLineBook` matched the repaid stage-1 line.

# Run

Anvil must already be the shared process on port 8545. This script does not start, reset, or kill it.

```
cd lockgate/repo/e2e
npm install
npm run e2e
```

Artifacts come from `contracts/out` after `forge build`. A failure writes `{ "error", "code" }` to stderr and exits 1. The signer is Anvil account 3, the public development key, passed to the engine as `LOCKGATE_PROPOSER_KEY`.
