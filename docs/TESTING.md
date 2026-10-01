# Testing

## SUMMARY

The harness clicks through stage 1, stage 2, and stage 3 on a fresh local Anvil and checks the test console over HTTP. On 2 Oct 2026 this session: Foundry 109 passed, 0 failed (26 suites, including `PartnerKeys` and the read-only USDG fork); engine vitest 58 passed, 0 failed (16 files); harness 9 passed, 0 failed. No Sepolia deploy was broadcast. Arbitrum One was not touched.

## How to run

From `lockgate/repo/harness`, after Foundry and Node 22 or newer are installed:

```bash
npm test
npm run deploy:local
```

`npm test` builds `contracts/` (sources only) and `harness/fixture`, then runs `harness/test`. The flow test starts its own Anvil on a free port other than 8545, which G9 may be using. It kills only that process.

`deploy:local` expects an Anvil already listening. `npm run anvil` starts one on `127.0.0.1:8546` and writes `harness/.anvil.pid`. Do not point it at 8545.

The console:

```bash
HARNESS_RPC=http://127.0.0.1:8546 npm run serve
```

It binds `127.0.0.1` and defaults to port 18910. The page title is "Lockgate test console". The page says it is not the product and not an offer.

CLI: `npm run cli -- read.status`. `help` prints the action ids.

Contracts, from `lockgate/repo/contracts`:

```bash
forge test
```

Engine, from `lockgate/repo/engine`:

```bash
npm test
```

## What this session ran

- `harness/test/units.test.ts`: 6-decimal parsing, the 99 bps demo window, chain 31337 allowed, chain 42161 refused, Sepolia blocked without the flag.
- `harness/test/flows.test.ts`: two fresh Anvils produce the same CREATE2 addresses. One Anvil runs `demoAll` and the HTTP console. The console GET checks the title and the not-an-offer line. `POST /api/act` with `token.faucet` returns 200. An unknown action returns 422.
- `harness/test/sepolia.test.ts`: no flag means no RPC call. A local node reporting chain 42161 reverts `MAINNET_REFUSED` before a deploy. A local node reporting 421614, with the published Anvil key and the allow flag, deploys the protocol. That test does not call the public endpoint.
- `engine`: `vitest run`, 16 files, 58 tests, all passed.
- `forge test` in `contracts/`: 26 suites, 109 tests, 0 failed, 0 skipped. That includes `PartnerKeys` and `test/fork/UsdgFork.t.sol`.
- Stage 1 on that Anvil: quote matches the constructor curve, a gate and a pause block the quote, a one-unit cash shortfall does not repay or roll the window, the queued exit pays only after the advance, and `markLate` consumes the 2000 USDG reserve.
- Stage 2 signs `LockgateAdvance`. Lockgate cannot withdraw, pause, set a mandate, or enlist before the partner does. Best-fee funding uses the 25 bps vault. Repayment leaves the fee in that vault. Pausing both vaults yields no slice. Two round-robin advances use different vaults. An upgrade is scheduled and not executed.
- Stage 3 uses `CreditLineBook` and a platform created after the stage-1 time warp. The facility draws 2000 USDG, refuses 5000 with `Covenant`, pays senior interest on a 10 USDG repayment, and enters recovery with junior principal down and senior principal unchanged.

The first 1100 shares are minted in the platform constructor without a matching USDG deposit, so the short-cash check is real. Later exits buy shares with USDG.

## What was not run

- `scripts/deploy-sepolia.ts` against public Arbitrum Sepolia. `USE_PAXOS_USDG=1` was not broadcast. That path would point `UsdgAdapter` at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` and would not mint. https://docs.paxos.com/guides/stablecoin/usdg/testnet
- Any transaction on Arbitrum One.
- Browser rendering. No browser tool was connected. The console was checked with `fetch` inside `flows.test.ts`.
- A production peg oracle. The harness oracle is the zero address.

`forge test` did read `https://sepolia-rollup.arbitrum.io/rpc` inside `UsdgFork`. That file is a `vm.createSelectFork` with no broadcast. The harness Sepolia script was not pointed at that URL.

## CI

`.github/workflows/ci.yml` checks out the repo, installs Foundry, runs `forge test`, runs the engine tests, and runs the harness tests. The repo had no git remote when this file was added, so GitHub Actions has not executed it. [U] until a remote exists and a run is green.
