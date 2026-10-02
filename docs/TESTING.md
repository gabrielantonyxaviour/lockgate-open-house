# Testing

## SUMMARY

The harness clicks through stage 1, stage 2, and stage 3 on a fresh local Anvil and checks the test console over HTTP. On 2 Oct 2026 the harness suite was run after the failure-injection check: 61 passed, 0 failed. The same suite was run again that day, after the current contracts were compiled and before the Anvil click-through in `harness/docs/how-to/run-on-anvil.md`: 61 passed, 0 failed. After the bytecode diff was added, the suite was run again: 71 passed, 0 failed. The final Anvil pass re-ran that suite: 71 passed, 0 failed, in 34787.267084 ms. After the cleanup command was added, the suite was run again: 81 passed, 0 failed, in 34824.536292 ms. After the assertion review, the suite was run again: 81 passed, 0 failed, in 35017.898208 ms. After each action result gained `timing.elapsedMs` and `timing.gasUsed`, the suite was run again: 86 passed, 0 failed, in 36235.0225 ms. After the artifact checksum was added, the suite was run again: 95 passed, 0 failed, in 40360.54925 ms. After the Anvil restart check was added, the suite was run again: 96 passed, 0 failed, in 50323.4 ms. After the written-record secret scan was added, the suite was run again: 98 passed, 0 failed, in 46278.970541 ms. After the current-tree check, the suite was run again: 98 passed, 0 failed, in 55455.614 ms. On clean Anvils at ports 8546, 8547, and 8548, preflight, deploy, bytecode, the console, every click-through row, both demos, and the Sepolia dry-run checks passed. Fresh bytecode was `compared` 18 and `matched` 18. After `stage1.registerPlatform` it was 19 and 19. The quote was `feeBps` 98 and `fee` 9800000. The 5000-share `received` value was 5066341700. `demo.stage3` printed `base` `4093600000` and `juniorAfter` `2009552502`. The two `demo.all` outputs matched. The limits that remain are listed in `harness/docs/how-to/run-on-anvil.md`. That run greps harness command output and the repo for a private key or an RPC token. It injects an RPC timeout, a reverted transaction, and a nonce conflict, and checks that each report is `{ error, code }` and that the manifest file is unchanged. It also builds a dry-run Arbitrum Sepolia manifest and executes the same plan on a private Anvil. It does not broadcast to Sepolia. The last full Foundry run recorded here is 181 passed, 0 failed (41 suites). The last engine vitest run is 65 passed, 0 failed (17 files). This pass did not re-run those two suites, and it did not edit `contracts/src` or `engine/`. No Sepolia deploy was broadcast. Arbitrum One was not touched.

## How to run

From `lockgate/repo/harness`, after Foundry and Node 22 or newer are installed:

```bash
npm test
npm run deploy:local
```

`npm test` runs `pretest` (`forge build --skip test --root ../contracts && forge build --root fixture`) and then `node --import tsx --test --test-concurrency=1 test/*.test.ts`. CI runs `forge test` with no skip. The flow test starts its own Anvil on a free port other than 8545, which G9 may be using. It kills only that process.

`deploy:local` expects an Anvil already listening. `npm run anvil` starts one on `127.0.0.1:8546` and writes `harness/.anvil.pid`. Do not point it at 8545. `npm run preflight` checks that RPC, chain 31337, the deployer balance, and the compiled artifacts before a deploy. `npm run bytecode` compares each deployed contract with the current artifact and returns `STALE` on a mismatch. `npm run cleanup` sends `anvil_reset` with no fork parameters to the loopback Anvil on port 8546, then removes the generated chain 31337 manifests. A failed reset leaves those files. Port 8545 is refused. `npm run preflight:sepolia` also requires the allow flag and `SEPOLIA_RPC`. `npm run manifest` prints a dry-run Arbitrum Sepolia deployment manifest and does not dial. `npm run manifest:local` records receipts on loopback chain 31337. `npm run report` prints one screen of deployed contracts, balances, mandates, and recent Anvil events. It does not send a transaction.

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

## How to verify partner

Verify the partner vault, the router, and the auto-approve module from `lockgate/repo/contracts`. Foundry 1.7.1 (commit `4072e487`, built 2026-05-08) has no `--profile` flag. `FOUNDRY_SRC` and `FOUNDRY_TEST` select this tree. `foundry.toml` sets fuzz runs to 256 and invariant runs to 40 at depth 25. The private `--out` and `--cache-path` keep the run off the shared `out/` and `cache/`. Leave those shared directories in place.

1. Run the partner suite:

```bash
FOUNDRY_SRC=src/partner FOUNDRY_TEST=test/partner forge test --offline --out /tmp/lg-dead-partner-out --cache-path /tmp/lg-dead-partner-cache
```

2. Run the bytecode size check on that same cache:

```bash
FOUNDRY_SRC=src/partner FOUNDRY_TEST=test/partner forge test --offline --match-test test_deployedCodeFitsEip170AndInitFitsEip3860 -vv --out /tmp/lg-dead-partner-out --cache-path /tmp/lg-dead-partner-cache
```

On 2026-10-02, after `error WrongVault()` was removed from `PartnerVaultAdmin`, step 1 compiled 124 files with Solc 0.8.28 in 51.12s and passed 29 suites, 122 tests, 0 failed, 0 skipped, in 260.34ms (1.43s CPU). `invariant_solvencyAndLockgateHasNoClaim` was 40 runs, 1000 calls, 0 reverts. Step 2 printed PartnerVault runtime 21272 and init 21514, PartnerRouter runtime 8444 and init 8474, and AutoApproveModule runtime 3362 and init 4529. The module init figure includes the constructor arguments.

### Next steps

- Read the measured handoff and the residual risks in [the partner README](../contracts/src/partner/README.md).
- Read the vault and facility findings in [SECURITY-NOTES-partner.md](SECURITY-NOTES-partner.md).

## What this session ran

- `harness/test/units.test.ts`: 6-decimal parsing, the 99 bps demo window, chain 31337 allowed, chain 42161 refused, Sepolia blocked without the flag. `help` lists `stage1.quote` with `--navUsdg 1000` and lists `--exitRef` with no default.
- `harness/test/fuzz.test.ts`: 256 draws keep the fee on the ceiling, monotone in bps, and equal to the floor or one unit above it. The stage-1 curve matches the constructor formula, stays monotone, and is 14203 bps at 86400 seconds. USDG text round-trips and rejects empty, negative, and over-precise input.
- `harness/test/entry.test.ts`: a missing deployer key and a short address are refused before any RPC, including when `SEPOLIA_RPC` points at `127.0.0.1:1`. A public RPC is `CHAIN_REFUSED`. Port 8545 is `PORT_RESERVED`. An empty URL, an oversized flag, a non-numeric Anvil port, and a manifest path over 512 characters are `VALIDATION`. Failure JSON is `{ error, code }` only. A 32-byte hex key is `0x[redacted]` and a 65-byte signature is kept. A local Anvil reporting chain id 1 is `CHAIN_REFUSED` before a transaction. That test does not dial a public chain.
- `harness/test/failures.test.ts`: invalid JSON, a missing action, and a nested input return 400 `VALIDATION` before any chain call. An unknown action returns 422. On one Anvil: `WindowClosed`, `OwnableUnauthorizedAccount`, a `FaucetCap` revert serialized as `{ error, code: "REVERT" }` with no stack and no key, a stranger `draw` as `Unauthorized`, a flipped engine signature as `BadEngineSig`. A second draft of a used nonce returns `REPLAY` before a transaction. A direct resubmit reverts `NonceUsed`. A signature for vault A submitted to vault B reverts `BadEngineSig` and leaves vault B's proposal hash empty. Vault tokens equal idle plus reserve, and the router balance is unchanged across `relayRepay`. A low peg is preview reason 11 and a stale update is reason 12. `approve` then reverts `MandateRejected`.
- `harness/test/security.test.ts`: loopback RPCs pass, port 8545 and the text `08545` are `PORT_RESERVED`, a public host is `CHAIN_REFUSED`. Signatures for chain 42161 and 421614 are refused before `signTypedData`. A fee equal to nav, and a payout off by one unit, are `VALIDATION`. `feeFromBps(1, 1)` is 1. A numeric JSON nav and a body over 8 KiB return 400 `VALIDATION`. Overlapping acts run one at a time.
- `harness/test/invariant.test.ts`: eligible + late = total exposure, and exposure is 0 before the first exit. The same identity holds after the exit and after `markLate`. `markLate` before grace reverts `TooEarly`. Facility `solvent()` holds, and the token balance matches `accounting.cash`. The borrower cannot `approveLender`. The governor cannot `draw`. Mandate preview rejects a low fee (7), a past deadline (16), a tenor one second over the max (8), and a 1 bp concentration cap (6). Equality on the deadline and on the max tenor is allowed.
- `harness/test/flows.test.ts`: two fresh Anvils produce the same CREATE2 addresses, including `FundFactory`. A deploy against an Anvil whose Lockgate nonce is not 0 returns `NOT_FRESH` and leaves the manifest file bytes unchanged. One Anvil runs `demoAll`, including `submitProposal` then partner `approve`, the factory-cloned epoch, and the HTTP console. The console GET checks the title and the not-an-offer line. `POST /api/act` with `token.faucet` returns 200. An unknown action returns 422.
- `harness/test/sepolia.test.ts`: no flag means no RPC call. A local node reporting chain 42161 reverts `MAINNET_REFUSED` before a deploy. A local node reporting 421614, with the published Anvil key and the allow flag, deploys the protocol, records the governor as partner A, and matches the factory and vault-proxy bytecode. A governor equal to the deployer returns `VALIDATION` before a contract is deployed. That test does not call the public endpoint.
- `harness/test/preflight.test.ts`: twelve tests. A mock probe stands in for the RPC. Local success returns chain 31337, the Anvil deployer, and the artifact count. An unreachable RPC is `RPC` and does not read the balance. Chain 42161 is `MAINNET_REFUSED` before the balance. The wrong chain is `CHAIN_REFUSED`. A balance under 0.001 ETH is `UNFUNDED` and does not load artifacts. A missing artifact is `NOT_BUILT`. Paxos mode skips `MockUSDG`. The Sepolia command does not dial before the allow flag, the key, and `SEPOLIA_RPC`. A public RPC and port 8545 do not dial. Failure JSON is `{ error, code }` only, and a 32-byte key in a probe error becomes `0x[redacted]`. `fetchProbe` is covered with a mocked `fetch`, not a live node.
- `harness/test/deployment-manifest.test.ts`: six tests. The Sepolia document is a dry run with addresses, constructor args, and null receipts. The same inputs match byte for byte. Nonce 1 changes the CREATE2 addresses. Paxos mode keeps `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` and does not dial. `broadcast` returns `SEPOLIA_BLOCKED` even when the allow flag, a key, and the public Sepolia URL are set. An approved check with a balance under 0.001 ETH returns `UNFUNDED` and still does not dial. Local execution on a private Anvil records a transaction hash for every contract, matches that hash's receipt block number, matches the factory bytecode, matches the dry-run addresses and constructor args, and leaves the file unchanged on `NOT_FRESH`. A public host, port 8545, and chain 42161 are refused before a transaction.
- `harness/test/hygiene.test.ts`: two tests. A planted 32-byte key and an Alchemy `/v2/` token are reported, and the finding JSON does not contain either string. The scan reads stdout and stderr from `help`, the Sepolia manifest, `broadcast`, both preflight commands, `deploy:sepolia`, and `deploy:local`, then walks the repo. A published Anvil key in source is allowed. The same key in command output fails the test. A public RPC with no token does not. The allow flag is empty and `HARNESS_RPC` is `http://127.0.0.1:1`.
- `harness/test/bytecode.test.ts`: ten tests. Filling an immutable span still matches. A byte outside those spans is `STALE` and names the contract. Empty or invalid code is `STALE`. Five mismatches name four contracts and count the rest. `PartnerVaultA` and `PartnerVaultB` match `ERC1967Proxy` and do not match `PartnerVault`. A public RPC and port 8545 do not dial. Chain 42161 is `MAINNET_REFUSED`. A manifest chain other than the RPC chain is `CHAIN_REFUSED` before code is read. A missing artifact is `NOT_BUILT` before a dial. A closed port returns `RPC is unreachable`. Failure JSON is `{ error, code }` only. A fresh Anvil deploy matches the current artifacts, with `compared` 18 and `matched` 18, and the factory bytecode matches `Create2Factory`. No bytecode is printed.
- `harness/test/cleanup.test.ts`: ten tests. A public RPC is `CHAIN_REFUSED` and port 8545 is `PORT_RESERVED` before a reset. Chain 42161 is `MAINNET_REFUSED`. A refused reset, a symlink, a directory in place of a manifest, a path outside `deployments/`, and the Sepolia manifest leave the files. A missing deployments directory still resets and removes nothing. A successful reset removes `31337.json`, `31337.demo.json`, `31337.deployment.json`, a numeric `.tmp` leftover, and an `HARNESS_MANIFEST` file inside that directory. It keeps notes and `421614.json`. `anvil_reset` is sent with an empty parameter list. A node error and a closed port leave the manifest and return `RPC`. `main` prints `{ error, code }` only. On a private Anvil the deployer nonce returns to 0, and the report contains no `0x` text.
- `harness/test/inject.test.ts`: three tests. A loopback listener answers the chain id and the deployer balance, then never answers again. The deploy reports `{ error: "RPC timed out", code: "RPC" }` and the sentinel manifest bytes stay in place. On a private Anvil, a faucet over the cap reports `REVERT` with `FaucetCap` and no key. Submitting nonce 0 after that deploy reports `NONCE` and `Transaction nonce conflict`. None of the three leaves a `.tmp` file or changes the manifest bytes. No public chain.
- `harness/test/smoke.test.ts`: one private Anvil, chain 31337, port other than 8545. The test posts every `stage1.*`, `stage2.*`, and `stage3.*` action to `POST /api/act`. The final chain has a repaid advance and a late advance, weekly reserve 0, the credit line unpaused, the platform ungated, vault A owned by the partner with nonce 1 repaid and nonce 4 open, a scheduled upgrade, and a facility in recovery whose senior principal is 10000 USDG and whose junior principal is below 4000. A new stage action id fails this test until the script calls it. No browser. No public chain.
- `engine`: `vitest run`, 17 files, 65 tests, all passed.
- `forge test` in `contracts/`: 41 suites, 181 tests, 0 failed, 0 skipped. That includes `PartnerKeys` and `test/fork/UsdgFork.t.sol`.
- Stage 1 on that Anvil: quote matches the constructor curve, a gate and a pause block the quote, a one-unit cash shortfall does not repay or roll the window, the queued exit pays only after the advance, and `markLate` consumes the 2000 USDG reserve.
- Stage 2 signs `LockgateAdvance`. Lockgate cannot withdraw, pause, set a mandate, or enlist before the partner does. Best-fee funding uses the 25 bps vault. Repayment leaves the fee in that vault. Pausing both vaults yields no slice. Two round-robin advances use different vaults. An upgrade is scheduled and not executed.
- Door 2 is removed (not deployed, superseded). `door2.cycle` and `door-gap.test.ts` are deleted, and `demo.all` is stage1, stage2, stage3.
- Stage 3 uses `CreditLineBook` and an epoch platform created by `FundFactory.createPlatform` (sent from the `lockgate` role, which is `onlyOwner`) after the stage-1 time warp. That clone is not the locked implementation. The facility draws 2000 USDG, refuses 5000 with `Covenant`, pays senior interest on a 10 USDG repayment, and enters recovery with junior principal down and senior principal unchanged.

The first 1100 shares are minted in the platform constructor without a matching USDG deposit, so the short-cash check is real. Later exits buy shares with USDG.

## What was not run

- `scripts/deploy-sepolia.ts` against public Arbitrum Sepolia. `USE_PAXOS_USDG=1` was not broadcast. That path would point `UsdgAdapter` at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` and would not mint. https://docs.paxos.com/guides/stablecoin/usdg/testnet
- Any transaction on Arbitrum One.
- Browser rendering. No browser tool was connected. The console was checked with `fetch` inside `flows.test.ts`. This pass also fetched `http://127.0.0.1:18910/` and `/api/surface` after `deploy:local` on `127.0.0.1:8546`. The title is "Lockgate test console" and the surface lists 40 actions.
- A production peg oracle. The harness oracle is the zero address.

`forge test` did read `https://sepolia-rollup.arbitrum.io/rpc` inside `UsdgFork`. That file is a `vm.createSelectFork` with no broadcast. The harness Sepolia script was not pointed at that URL.

## CI

`.github/workflows/ci.yml` checks out the repo, installs Foundry, runs `forge test`, runs the engine tests, and runs the harness tests. The repo had no git remote when this file was added, so GitHub Actions has not executed it. [U] until a remote exists and a run is green.

2026-10-02 additions: `harness/test/caps.test.ts` (line caps 8000/10000 on deploy), `harness/test/sepolia-paxos.test.ts` (Paxos USDG seed on a local 421614 Anvil: token code with no minter at the Paxos address, seed, then an investor deposits and exits through the line). Contract regressions: `contracts/test/core/FactoryDrain.t.sol`, `contracts/test/partner/RouterGrief.t.sol`, and `test_recordedCounterexampleHolds` in `contracts/test/facility/LossSymmetry.t.sol`. The harness protocol plan is 16 contracts. Counts above predate these changes.
