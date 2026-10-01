# Testing

## SUMMARY

The harness clicks through stage 1, door 2, stage 2, and stage 3 on a fresh local Anvil and checks the test console over HTTP. On 2 Oct 2026 the harness was run again after the security review: 24 passed, 0 failed. The last full Foundry run recorded here is 181 passed, 0 failed (41 suites). The last engine vitest run is 65 passed, 0 failed (17 files). This pass did not re-run those two suites, and it did not edit `contracts/src` or `engine/`. No Sepolia deploy was broadcast. Arbitrum One was not touched.

## How to run

From `lockgate/repo/harness`, after Foundry and Node 22 or newer are installed:

```bash
npm test
npm run deploy:local
```

`npm test` builds `contracts/` with `forge build --skip test`, builds `harness/fixture`, then runs `harness/test`. The ExitPool skip has been removed. CI runs `forge test` with no skip. The flow test starts its own Anvil on a free port other than 8545, which G9 may be using. It kills only that process.

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
- `harness/test/fuzz.test.ts`: 256 draws keep the fee on the ceiling, monotone in bps, and equal to the floor or one unit above it. The stage-1 curve matches the constructor formula, stays monotone, and is above 1500 bps at 86400 seconds. USDG text round-trips and rejects empty, negative, and over-precise input.
- `harness/test/failures.test.ts`: invalid JSON, a missing action, and a nested input return 400 `VALIDATION` before any chain call. An unknown action returns 422. On one Anvil: `WindowClosed`, `OwnableUnauthorizedAccount`, `FaucetCap`, a stranger `draw` as `Unauthorized`, a flipped engine signature as `BadEngineSig`. A second draft of a used nonce returns `REPLAY` before a transaction. A direct resubmit reverts `NonceUsed`. A signature for vault A submitted to vault B reverts `BadEngineSig` and leaves vault B's proposal hash empty. Vault tokens equal idle plus reserve, and the router balance is unchanged across `relayRepay`. A low peg is preview reason 11 and a stale update is reason 12. `approve` then reverts `MandateRejected`.
- `harness/test/security.test.ts`: loopback RPCs pass, port 8545 and the text `08545` are `PORT_RESERVED`, a public host is `CHAIN_REFUSED`. Signatures for chain 42161 and 421614 are refused before `signTypedData`. A fee equal to nav, and a payout off by one unit, are `VALIDATION`. `feeFromBps(1, 1)` is 1. A numeric JSON nav and a body over 8 KiB return 400 `VALIDATION`. Overlapping acts run one at a time.
- `harness/test/invariant.test.ts`: eligible + late = total exposure before a draw, after it, and after `markLate`. `markLate` before grace reverts `TooEarly`. Facility `solvent()` holds, and the token balance matches `accounting.cash`. The borrower cannot `approveLender`. The governor cannot `draw`. Mandate preview rejects a low fee (7), a past deadline (16), a tenor one second over the max (8), and a 1 bp concentration cap (6). Equality on the deadline and on the max tenor is allowed.
- `harness/test/flows.test.ts`: two fresh Anvils produce the same CREATE2 addresses, including `FundFactory`, `OpenCreditVault`, and `LockgateExitPool`. One Anvil runs `demoAll`, including door 2, `submitProposal` then partner `approve`, the factory-cloned epoch, and the HTTP console. The console GET checks the title and the not-an-offer line. The surface includes `door2.cycle`. `POST /api/act` with `token.faucet` returns 200. An unknown action returns 422.
- `harness/test/sepolia.test.ts`: no flag means no RPC call. A local node reporting chain 42161 reverts `MAINNET_REFUSED` before a deploy. A local node reporting 421614, with the published Anvil key and the allow flag, deploys the protocol and records the governor as partner A. A governor equal to the deployer returns `VALIDATION` before a contract is deployed. That test does not call the public endpoint.
- `engine`: `vitest run`, 17 files, 65 tests, all passed.
- `forge test` in `contracts/`: 41 suites, 181 tests, 0 failed, 0 skipped. That includes `PartnerKeys` and `test/fork/UsdgFork.t.sol`.
- Stage 1 on that Anvil: quote matches the constructor curve, a gate and a pause block the quote, a one-unit cash shortfall does not repay or roll the window, the queued exit pays only after the advance, and `markLate` consumes the 2000 USDG reserve.
- Stage 2 signs `LockgateAdvance`. Lockgate cannot withdraw, pause, set a mandate, or enlist before the partner does. Best-fee funding uses the 25 bps vault. Repayment leaves the fee in that vault. Pausing both vaults yields no slice. Two round-robin advances use different vaults. An upgrade is scheduled and not executed.
- Door 2, after stage 1 and before stage 2: the pool is registered at reserve bps 0. The investor deposits 1000 USDG. A gated sell reverts `Gated`. The 300-second cooldown quotes 49 bps. The seller receives nav minus fee. `settle` before `readyAt` reverts `NotReady`. After the cooldown the advance remaining is 0 and partner idle is unchanged.
- Stage 3 uses `CreditLineBook` and an epoch platform created by `FundFactory.createPlatform` after the stage-1 time warp. That clone is not the locked implementation. The facility draws 2000 USDG, refuses 5000 with `Covenant`, pays senior interest on a 10 USDG repayment, and enters recovery with junior principal down and senior principal unchanged.

The first 1100 shares are minted in the platform constructor without a matching USDG deposit, so the short-cash check is real. Later exits buy shares with USDG.

## What was not run

- `scripts/deploy-sepolia.ts` against public Arbitrum Sepolia. `USE_PAXOS_USDG=1` was not broadcast. That path would point `UsdgAdapter` at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` and would not mint. https://docs.paxos.com/guides/stablecoin/usdg/testnet
- Any transaction on Arbitrum One.
- Browser rendering. No browser tool was connected. The console was checked with `fetch` inside `flows.test.ts`.
- A production peg oracle. The harness oracle is the zero address.

`forge test` did read `https://sepolia-rollup.arbitrum.io/rpc` inside `UsdgFork`. That file is a `vm.createSelectFork` with no broadcast. The harness Sepolia script was not pointed at that URL.

## CI

`.github/workflows/ci.yml` checks out the repo, installs Foundry, runs `forge test`, runs the engine tests, and runs the harness tests. The repo had no git remote when this file was added, so GitHub Actions has not executed it. [U] until a remote exists and a run is green.
