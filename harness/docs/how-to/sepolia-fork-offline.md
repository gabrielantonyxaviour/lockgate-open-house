# Reproduce the Sepolia fork checks offline

Run the checks below from a machine that does not call `https://sepolia-rollup.arbitrum.io/rpc`. You get the adapter binding, the 600-second quote, the stage-1 draw and repay, and the partner repayment. Leave port 8545 alone. Leave `LOCKGATE_ALLOW_SEPOLIA_DEPLOY` unset except inside the harness test that already sets it for a private Anvil.

The nine fork tests live in `contracts/test/fork`. Each `setUp` calls `vm.createSelectFork` on that public URL. On Forge 1.7.1, `forge test --offline` still makes the call. With the host blocked, all four suites failed in `setUp` and ran no assertion. Forge reported 4 failed tests, one per file:

```text
vm.createSelectFork: could not instantiate forked environment with provider sepolia-rollup.arbitrum.io; error sending request for url (https://sepolia-rollup.arbitrum.io/rpc); client error (Connect); dns error; failed to lookup address information: nodename nor servname provided, or not known
```

`contracts/test/fork/README.md` records the last pass of those files: 9 passed, 0 failed. This page did not repeat that pass.

## Run the offline contract checks

From `lockgate/repo/contracts`:

```bash
forge test --offline --match-contract 'UsdgAdapterTest|PricingTest|Stage1Flow|PartnerKeys'
```

These four files do not call `createSelectFork`. On Forge 1.7.1 the run compiled 27 files with Solc 0.8.28. Durations vary. The counts were:

```text
Ran 3 tests for test/core/UsdgAdapter.t.sol:UsdgAdapterTest
Suite result: ok. 3 passed; 0 failed; 0 skipped
Ran 6 tests for test/invariant/Stage1Flow.t.sol:Stage1Flow
Suite result: ok. 6 passed; 0 failed; 0 skipped
Ran 5 tests for test/invariant/PartnerKeys.t.sol:PartnerKeys
Suite result: ok. 5 passed; 0 failed; 0 skipped
Ran 7 tests for test/core/Pricing.t.sol:PricingTest
Suite result: ok. 7 passed; 0 failed; 0 skipped
Ran 4 test suites in 20.89ms (29.97ms CPU time): 21 tests passed, 0 failed, 0 skipped (21 total tests)
```

`PricingTest` includes `testFuzz_timeAndUtilMonotone` at 256 runs. `test_demoWaitIsAboutOnePercent`, `test_canonicalSepoliaCannotBeMock`, `test_tenMinuteWaitQuotes99Bps`, `test_repayPullsThePlatformAndLeavesTheInvestor`, `test_gateAndPauseBlockDraws`, `test_strangerCannotMoveCapital`, `test_lockgateCannotMoveOrGovernFunds`, and `test_repaymentReturnsToTheFundingVault` each printed `[PASS]`.

## Match each fork test to that run

`U` in the fork files is `1000000`.

| Fork test | What a pass pins | Offline test that passed |
|---|---|---|
| `UsdgFork.test_adapterBindsTheCanonicalTokenAsNotMock` | Token `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, `isCanonicalSepoliaUsdg` true, `isMock` false, decimals 6 | `test_canonicalSepoliaCannotBeMock` etches local code at that address |
| `UsdgFork.test_canonicalTokenCannotBeMarkedMock` | `UsdgAdapter` constructor reverts `CanonicalCannotBeMock` | Same offline test |
| `UsdgFork.test_usdgIsSixDecimals` | Chain id 421614, symbol `USDG`, decimals 6, supply greater than 0 | No offline test reads the live proxy |
| `UsdgFork.test_transferConservesSupply` | A `1000e6` balance sends `250e6`. Balances end at `750e6` and `250e6`. Supply is unchanged | No offline test reads the live proxy |
| `UsdgFork.test_transferAboveBalanceReverts` | A `101e6` transfer from `100e6` reverts and moves nothing | No offline test reads the live proxy |
| `SepoliaExit.test_canonicalBookQuotesAndRepays` | Chain id 421614, 99 bps, fee `99e6` on nav `10000e6`, investor receives `9901e6`, repay leaves that balance, outstanding returns to 0, earned fees stay `99e6`, supply unchanged | `test_tenMinuteWaitQuotes99Bps` and `test_repayPullsThePlatformAndLeavesTheInvestor` on `MockUSDG` |
| `SepoliaExit.test_gateAndStrangerLeaveCanonicalCash` | A gated draw reverts `Gated`. A stranger `withdrawCapital` reverts. Cash is unchanged | `test_gateAndPauseBlockDraws` and `test_strangerCannotMoveCapital` |
| `SepoliaPartner.test_repaymentReturnsToTheVaultAndLockgateTakesNothing` | Chain id 421614. Lockgate `withdraw` reverts `Unauthorized` and the balance stays 0. Idle ends at the deposit plus `100e6`. Outstanding principal returns to 0. Supply is unchanged | `test_lockgateCannotMoveOrGovernFunds` and `test_repaymentReturnsToTheFundingVault`. The offline repay goes through `relayRepay`. The deposit in that file is `50000e6` |
| `SepoliaFacility.test_drawAndRepayStayInsideTheFacility` | Chain id 421614. Senior deposits `100e6`. A stranger draw reverts `Unauthorized`. The borrower draws `40e6` and repays it. Cash returns to `100e6`. Drawn returns to 0. `solvent()` stays true. Supply is unchanged | No offline test in the command above uses the canonical token |

`Stage1Flow` also pauses the line inside `test_gateAndPauseBlockDraws`. The fork gate test does not pause. Both still require the `Gated` revert before a draw.

## Run the harness checks

From `lockgate/repo/harness`. The manifest command prints one JSON object. Constructor args make that line long. Read these fields only.

```bash
DEPLOYER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
GOVERNOR_ADDRESS=0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 \
PARTNER_A_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
PARTNER_B_ADDRESS=0x90F79bf6EB2c4f870365E785982E1f101E93b906 \
npm run manifest --silent
```

Mock asset. `mode` is `dry-run`, `target` is `sepolia`, `chainId` is `421614`, `asset` is `mock`, `factory` is `0x5FbDB2315678afecb367f032d93F642f64180aa3`, and `steps` has 18 entries. Every `txHash` and `blockNumber` is null. The `MockUSDG` step is `create2` at `0xe32E788308cCDA7e20A67Dd288416D9Dff69410d`, and that address is the first `UsdgAdapter` constructor arg. That address is this recording. A later rebuild moved the CREATE2 set. The new dry-run address is in [g6-g7-g8.md](g6-g7-g8.md).

Add `USE_PAXOS_USDG=1` to the same command. `asset` becomes `paxos`. The `MockUSDG` step is `external` at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, and the adapter constructor uses that address. Receipts stay null. The command does not dial.

`FACTORY_NONCE=no` with the same four addresses exits 1. Stderr:

```json
{"error":"FACTORY_NONCE must be an integer","code":"VALIDATION"}
```

These three exit 1. Stdout is empty.

```bash
npm run manifest --silent -- broadcast
npm run preflight:sepolia --silent
npm run deploy:sepolia --silent
```

`npm run manifest --silent -- broadcast` prints:

```json
{"error":"Sepolia broadcast stays a dry run. briefs/grok/G10-harness-deploy.md does not approve a funded deploy","code":"SEPOLIA_BLOCKED"}
```

`preflight:sepolia` and `deploy:sepolia` each print:

```json
{"error":"Sepolia broadcast is blocked until LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1","code":"SEPOLIA_BLOCKED"}
```

The harness tests that deploy on a private Anvil reporting chain 421614, and the 99 bps curve check:

```bash
node --import tsx --test --test-concurrency=1 --test-name-pattern '600 second|sepolia broadcast|sepolia script|governor equal' test/units.test.ts test/sepolia.test.ts
```

That run printed `tests 5`, `pass 5`, `fail 0`, `duration_ms 1847.457041`. The passing names are `sepolia broadcast stays off without the allow flag`, `sepolia broadcast refuses a node that reports chain 42161`, `sepolia script deploys the protocol on local chain 421614`, `sepolia script refuses a governor equal to the deployer`, and `stage-1 curve prices a 600 second demo window at 99 bps`. The deploy test checks factory `0x5FbDB2315678afecb367f032d93F642f64180aa3` and compares the vault proxy with `ERC1967Proxy`. It does not call the public URL.

## Next steps

- Read [the Anvil click-through](run-on-anvil.md) for the chain 31337 commands and the dry-run manifest.
- Read [the fork notes](../../../contracts/test/fork/README.md) for the public-RPC run of the nine tests.
- Read [the harness overview](../../README.md) for the path from Anvil to one CLI call.
- Read [the current-tree check](g6-g7-g8.md) for the CREATE2 addresses after the later rebuild.
