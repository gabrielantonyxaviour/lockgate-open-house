# Audit readiness

## SUMMARY

Scope is `src/core` and `src/interfaces`. On the shipping build (solc 0.8.28, optimizer 200, via IR, Cancun) every deployable contract is under the EIP-170 runtime cap of 24576 bytes and the EIP-3860 init-code cap of 49152 bytes. The largest runtime is `EpochQueuePlatform` at 14905 bytes (init 21093). Factory runtime is 4952 and init code is 5825. This `FOUNDRY_PROFILE=core forge build --sizes --offline` compiled 100 files in 70.65s, after the epoch preview started counting only slices that burn shares. `PlatformBase` and `WeeklyCyclePlatform` stay runtime 14635 and init 20823. `QuarterlyWindowPlatform` stays runtime 14663 and init 20851. `LockgateCreditLine` stays runtime 12465 and init 13373. `PlatformReserve` stays runtime 3423 and init 3865. The dead-storage compile had `EpochQueuePlatform` at 14672/20860 and finished in 63.62s, after `requestCycle` was removed. The verification before that removal had `EpochQueuePlatform` at 14741/20929, `QuarterlyWindowPlatform` at 14732/20920, and `PlatformBase` and `WeeklyCyclePlatform` at 14704/20892. The credit line and the reserve were already 12465/13373 and 3423/3865 on that verification, which compiled in 64.39s. An earlier measurement had the credit line at 12515/13423 and the reserve at 3393/3835. The core profile on that compiler passed 27 suites and 135 tests with 0 failures and 0 skips. That run followed `forge clean` and a fresh `forge build` that compiled 99 files in 61.05s. The test run skipped compilation and finished in 573.85ms (1.76s CPU). A later NatSpec-only `FOUNDRY_PROFILE=core forge test --offline` compiled 99 files in 59.43s and passed the same 27 suites and 135 tests in 448.90ms (1.45s CPU). A later revert-path `FOUNDRY_PROFILE=core forge test --offline` passed 28 suites and 144 tests in 488.73ms (1.76s CPU). Compilation was skipped. The compile of that tree, before the last vault test, was 100 files in 61.93s. The rounding pass compiled 100 files in 63.60s and passed 28 suites and 147 tests in 525.57ms (1.47s CPU). The three core invariants on that run each stayed at 64 runs, depth 40, 2560 calls, 0 reverts. The repayment-order pass compiled the core profile in 71.45s and passed 29 suites and 150 tests in 515.60ms (2.26s CPU). Its three core invariants each stayed at 64 runs, depth 40, 2560 calls, 0 reverts. `RepayOrderFuzzTest` at `--fuzz-runs 10000` passed 3 tests in 2.44s (4.88s CPU). This final re-run compiled the core profile in 65.38s and passed 28 suites and 147 tests in 521.98ms (1.88s CPU). Its three core invariants each stayed at 64 runs, depth 40, 2560 calls, 0 reverts. The invariant directory compiled 127 files in 29.05s and passed 15 suites and 49 tests in 594.52ms (1.52s CPU). Sizes were not recompiled. The preview size table still applies: `EpochQueuePlatform` runtime 14905, init 21093, compiled in 70.65s. This preview pass compiled the core profile in 70.61s and passed 28 suites and 147 tests in 491.42ms (1.64s CPU). Its three core invariants each stayed at 64 runs, depth 40, 2560 calls, 0 reverts. The invariant directory compiled 127 files in 33.13s and passed 15 suites and 49 tests in 603.10ms (1.46s CPU). The dead-storage pass compiled the core profile in 63.79s and passed 28 suites and 147 tests in 484.84ms (1.56s CPU). Its three core invariants each stayed at 64 runs, depth 40, 2560 calls, 0 reverts. The invariant directory compiled 127 files in 27.97s and passed 15 suites and 49 tests in 584.22ms (1.34s CPU). The prior verification core profile compiled 100 files in 64.46s and passed 28 suites and 147 tests in 498.79ms (1.38s CPU). Its three core invariants each stayed at 64 runs, depth 40, 2560 calls, 0 reverts. The invariant directory on that verification passed 15 suites and 49 tests with 0 failures and 0 skips. Solc 0.8.28 compiled 127 files in 28.44s. Tests finished in 586.97ms (1.42s CPU). The revert-path measurement was the same 15 suites and 49 tests, compiled in 27.81s, and finished in 620.24ms (1.75s CPU). An earlier run before `Roles.t.sol` was the same 15 suites and 49 tests, compiled in 27.01s, and finished in 584.05ms (1.43s CPU). `QueueReserve.t.sol` is under `test/core`, so it is outside that suite. Line coverage with `--ir-minimum` is 94.34% (816/865). That coverage run failed `test_factoryFitsBothSizeLimits` because the coverage compiler measured factory runtime 29467. The shipping factory runtime is 4952.

Written 2026-10-02. This file is uncommitted. `git log -1` is `9665484`. The repo has no remote. Trust assumptions and the per-contract threat model are in `SECURITY-NOTES.md`. The 2026-10-02 findings list is in `../docs/SECURITY-NOTES-contracts.md`.

## Scope

In scope:

- `src/core`: `CreditLineAdmin` (abstract), `LockgateCreditLine`, `PlatformReserve`, `PlatformStore` (abstract), `PlatformBase`, `WeeklyCyclePlatform`, `EpochQueuePlatform`, `QuarterlyWindowPlatform`, `PlatformShare`, `PlatformConfig` (a struct, no functions), `FundFactory`, `PricingEngine`, `PricingMath`, `UsdgAdapter`, `UsdgTransfers`, `MockUSDG`, `OpenCreditVault`, `LockgateExitPool`.
- `src/interfaces`: `ILockgateCreditLine`, `ICreditSource`, `IIssuerFund`, `IQueueAdapter`, `IFundFactory`, `IPlatformReserve`, `IPricingEngine`, `IUsdgAdapter`, `IMockUSDG`, `IOpenCreditVault`, `ILockgateExitPool`, `IAdvanceProposal`, `AdvanceProposalLib`.

Out of scope for this package: `src/partner`, the rest of `src/facility`, `engine`, `harness`, `sim`, and `e2e`. `src/facility/CreditLineBook.sol` appears in the size and coverage output because `test/core/Stage3Edges.t.sol` deploys it. It is not a core deployable. `test/invariant` is a separate suite. OpenZeppelin and forge-std are vendored dependencies.

## Contract sizes

Command, from this directory, 2026-10-02:

```bash
FOUNDRY_PROFILE=core forge build --sizes --offline
```

Exit 0. This compile finished in 70.65s. The dead-storage compile finished in 63.62s. The verification compile finished in 64.39s. An earlier compile finished in 49.20s. The `FundFactory` artifact matches the table: init code 5825 bytes, runtime 4952 bytes (`0.8.28+commit.7893614a`). `EpochQueuePlatform` moved on this compile. The other three queue contracts stayed at the dead-storage sizes. `LockgateCreditLine` and `PlatformReserve` moved on the verification compile. The earlier bytes were 12515/13423 and 3393/3835. Init-code size in this table does not include ABI-encoded constructor arguments. `test_factoryFitsBothSizeLimits` adds `7 * 32` bytes for the factory constructor and `abi.encode` of an empty `PlatformConfig` for each queue implementation.

Caps: deployed bytecode 24576 bytes (<https://eips.ethereum.org/EIPS/eip-170>), init code 49152 bytes (<https://eips.ethereum.org/EIPS/eip-3860>). Margin is the cap minus the measured size.

| Contract | Runtime | Init | Runtime margin | Init margin |
| --- | ---: | ---: | ---: | ---: |
| EpochQueuePlatform | 14905 | 21093 | 9671 | 28059 |
| QuarterlyWindowPlatform | 14663 | 20851 | 9913 | 28301 |
| PlatformBase | 14635 | 20823 | 9941 | 28329 |
| WeeklyCyclePlatform | 14635 | 20823 | 9941 | 28329 |
| LockgateCreditLine | 12465 | 13373 | 12111 | 35779 |
| PricingEngine | 5717 | 6613 | 18859 | 42539 |
| OpenCreditVault | 5232 | 6378 | 19344 | 42774 |
| FundFactory | 4952 | 5825 | 19624 | 43327 |
| LockgateExitPool | 4846 | 5674 | 19730 | 43478 |
| PlatformReserve | 3423 | 3865 | 21153 | 45287 |
| PlatformShare | 2965 | 3960 | 21611 | 45192 |
| MockUSDG | 2532 | 3543 | 22044 | 45609 |
| UsdgAdapter | 678 | 1077 | 23898 | 48075 |

`CreditLineAdmin` and `PlatformStore` are abstract and have no row. `PlatformConfig` has no bytecode. `PricingMath`, `UsdgTransfers`, and `AdvanceProposalLib` print as 57-byte runtime and 85-byte init. Those figures are the unlinked library placeholder. The same placeholder appears for the OpenZeppelin libraries the build pulled in (`Clones`, `Create2`, `Errors`, `Math`, `Panic`, `SafeCast`, `SafeERC20`).

The same command also sized test doubles (`AdvanceHandler`, `BookHandler`, `QueueHandler`, `StubSource`, `CallbackUsdg`, `Eighteen`, `FalseApproveToken`, `ReenterToken`, `SkimToken`, `TaxToken`) and `CreditLineBook` (runtime 505, init 669). Those rows are not product deployables.

The build printed Foundry lint warnings and still exited 0: `block-timestamp`, `unsafe-typecast`, and `erc20-unchecked-transfer`. This package does not triage them. The lint notes are at <https://book.getfoundry.sh/reference/forge/forge-lint>.

## Dependencies

| Piece | Version | Where it was read |
| --- | --- | --- |
| Foundry `forge` | 1.7.1, commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, built 2026-05-08 | `forge --version` |
| solc | 0.8.28 (`0.8.28+commit.7893614a` in the factory artifact) | `foundry.toml`, artifact metadata |
| Optimizer | on, 200 runs | `foundry.toml` |
| via IR | on for the shipping build | `foundry.toml` |
| EVM | Cancun | `foundry.toml` |
| OpenZeppelin Contracts | 5.3.0 | `lib/openzeppelin-contracts/package.json` |
| forge-std | 1.11.0 | `lib/forge-std/package.json` |

This Foundry build has no `--profile` flag. `FOUNDRY_PROFILE=core` selects `[profile.core]`: `src/core`, `test/core`, fuzz 512, invariants 64 runs at depth 40, `fail_on_revert = false`.

## Tests

| Command | Result |
| --- | --- |
| `FOUNDRY_PROFILE=core forge test --offline` | 30 suites, 152 passed, 0 failed, 0 skipped. Caller views. Solc 0.8.28 compiled 102 files in 69.89s. Tests finished in 500.42ms (2.65s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline` | 29 suites, 150 passed, 0 failed, 0 skipped. Repayment-order fuzz. Solc 0.8.28 compiled 101 files in 71.45s. Tests finished in 515.60ms (2.26s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline --match-contract RepayOrderFuzzTest --fuzz-runs 10000` | 1 suite, 3 passed, 0 failed, 0 skipped. Fuzz runs 10000. Solc 0.8.28 compiled 69 files in 11.69s. Tests finished in 2.44s (4.88s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline` | 28 suites, 147 passed, 0 failed, 0 skipped. Final re-run. Solc 0.8.28 compiled 100 files in 65.38s. Tests finished in 521.98ms (1.88s CPU). |
| `FOUNDRY_TEST=test/invariant forge test --offline` | 15 suites, 49 passed, 0 failed, 0 skipped. Final re-run. Solc 0.8.28 compiled 127 files in 29.05s. Tests finished in 594.52ms (1.52s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline` | 28 suites, 147 passed, 0 failed, 0 skipped. Epoch preview matches pro-rata floors. Solc 0.8.28 compiled 100 files in 70.61s. Tests finished in 491.42ms (1.64s CPU). |
| `FOUNDRY_TEST=test/invariant forge test --offline` | 15 suites, 49 passed, 0 failed, 0 skipped. Epoch preview. Solc 0.8.28 compiled 127 files in 33.13s. Tests finished in 603.10ms (1.46s CPU). |
| `FOUNDRY_PROFILE=core forge build --sizes --offline` | Epoch preview. Solc 0.8.28 compiled 100 files in 70.65s. Matches section 2. Largest runtime `EpochQueuePlatform` 14905, init 21093. `LockgateCreditLine` 12465/13373. `PlatformReserve` 3423/3865. Factory runtime 4952, init 5825. |
| `FOUNDRY_PROFILE=core forge test --offline` | 28 suites, 147 passed, 0 failed, 0 skipped. Dead storage removed. Solc 0.8.28 compiled 100 files in 63.79s. Tests finished in 484.84ms (1.56s CPU). |
| `FOUNDRY_TEST=test/invariant forge test --offline` | 15 suites, 49 passed, 0 failed, 0 skipped. Dead storage removed. Solc 0.8.28 compiled 127 files in 27.97s. Tests finished in 584.22ms (1.34s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline` | 28 suites, 147 passed, 0 failed, 0 skipped. Verification. Solc 0.8.28 compiled 100 files in 64.46s. Tests finished in 498.79ms (1.38s CPU). |
| `FOUNDRY_TEST=test/invariant forge test --offline` | 15 suites, 49 passed, 0 failed, 0 skipped. Verification, before `requestCycle` was removed. Solc 0.8.28 compiled 127 files in 28.44s. Tests finished in 586.97ms (1.42s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline` | 28 suites, 147 passed, 0 failed, 0 skipped. Rounding pins. Solc 0.8.28 compiled 100 files in 63.60s. Tests finished in 525.57ms (1.47s CPU). |
| `FOUNDRY_PROFILE=core forge test --offline` | 28 suites, 144 passed, 0 failed, 0 skipped. Revert paths. Compilation skipped. Tests finished in 488.73ms (1.76s CPU). The compile of that tree, before the last vault test, was 100 files in 61.93s. |
| `forge clean`, then `FOUNDRY_PROFILE=core forge build --offline` | `out/` and `cache/` removed first. Solc 0.8.28 compiled 99 files in 61.05s. Exit 0. |
| `FOUNDRY_PROFILE=core forge test --offline` | 27 suites, 135 passed, 0 failed, 0 skipped. Ran on that clean build. Compilation skipped. Tests finished in 573.85ms (1.76s CPU). Recorded in the [handoff](README.md#handoff). |
| `FOUNDRY_TEST=test/invariant forge test --offline` | 15 suites, 49 passed, 0 failed, 0 skipped. Revert-path tree. Solc 0.8.28 compiled 127 files in 27.81s. Tests finished in 620.24ms (1.75s CPU). |
| `FOUNDRY_PROFILE=core forge build --sizes --offline` | Dead storage removed. Solc 0.8.28 compiled 100 files in 63.62s. Largest runtime `EpochQueuePlatform` 14672. `LockgateCreditLine` 12465/13373. `PlatformReserve` 3423/3865. Factory runtime 4952, init 5825. |
| `FOUNDRY_PROFILE=core forge build --sizes --offline` | Verification, before `requestCycle` was removed. Solc 0.8.28 compiled 100 files in 64.39s. Largest runtime `EpochQueuePlatform` 14741. `LockgateCreditLine` 12465/13373. `PlatformReserve` 3423/3865. Factory runtime 4952, init 5825. |

The core profile runs every file in `test/core`. The 152 adds the two tests in `CallerViews.t.sol` on top of the 150. The 150 adds the three tests in `RepayOrderFuzz.t.sol` on top of the 147. The 147 adds `test_utilizationViewFloorsWhileTheNextUnitCeilsOver`, `test_zeroCapitalReportsFullUtilizationAndQuotesCapital`, and `test_epochProRataLeavesOneUnitAndBothStayQueued` on top of the 144. The 144 includes 8 tests in `RevertPaths.t.sol` and `test_oneUnitDepositRoundsToZeroOnceNavPassesIt`. The prior 135 includes 3 tests in `OpenHoles.t.sol`, 9 in `AccessEvents.t.sol`, 2 in `QueueReserve.t.sol`, `test_pauseAndResumeLeaveTheOpenBook` in `Stage3Edges.t.sol`, `test_feeStartsOnTheUnitPastPrincipal`, `test_emptyReserveStillMarksTheWholeFaceLate`, `test_ownerWithdrawsIdleWhileTheFeeIsUnrealized`, `test_firstAdvanceClearsAndTheNextShortfallHoldsTheWindow`, and `test_grantRevokeAndRenounceLeaveRepayAndCashReachable`. This package did not author `OpenHoles.t.sol`. The shipping fuzz budget is 512 runs. The three core invariants in that profile are `invariant_bookAndReserveBalance`, `invariant_queueEscrowAndBook`, and `invariant_reserveMatchesAdvances`, each 64 runs, depth 40, 2560 calls, 0 reverts.

The prior tree, before that pause test, was run the same day with `--fuzz-runs 10000`, `FOUNDRY_INVARIANT_RUNS=256`, and `FOUNDRY_INVARIANT_DEPTH=80`: 26 suites, 129 passed, 0 failed, 0 skipped. The two book invariants ran 256 times at depth 80 (20480 calls, 0 reverts). `invariant_reserveMatchesAdvances` stayed at 64 runs and 2560 calls because `AdvanceReserveInvariant.t.sol` pins those values. The counts are in the [handoff](README.md#handoff).

The invariant-directory suite on this pass adds `invariant_fundsAreConserved` (32 runs, depth 20, 640 calls, 0 reverts), `invariant_solvencyFeeBoundsAndRepayFirst` (64 runs, depth 40, 2560 calls, 0 reverts), and `invariant_cashStaysWithThePartner` (64 runs, depth 40, 2560 calls, 0 reverts).

## Coverage

A coverage run with the optimizer and via IR left off does not compile this profile. `foundry.toml` records that legacy codegen hits stack-too-deep once `PricingMath.quote` is inlined. The report below is:

```bash
FOUNDRY_PROFILE=core forge coverage --offline --ir-minimum --report summary --exclude-tests
```

Foundry's own warning: `--ir-minimum` enables via IR with minimum optimization and can make source mappings inaccurate. Treat the percentages as that build. The shipping sizes are the table above.

The command executed the tree from before `AccessEvents.t.sol`: 24 suites, 117 tests passed, 1 failed, 0 skipped (118 total). Exit 1. Coverage was not regenerated after the access edits. The failure is `test_factoryFitsBothSizeLimits` in `test/core/FactoryDemo.t.sol`. The first check is `address(factory).code.length <= 24576`. Under `--ir-minimum` that length is 29467. The shipping factory runtime is 4952. The test and the factory were left as they are.

`% Branches` of `100.00% (0/0)` is an empty denominator in Foundry's summary.

| File | Lines | Statements | Branches | Funcs |
| --- | --- | --- | --- | --- |
| src/core/CreditLineAdmin.sol | 97.03% (98/101) | 89.93% (125/139) | 54.55% (12/22) | 96.55% (28/29) |
| src/core/EpochQueuePlatform.sol | 75.00% (3/4) | 50.00% (1/2) | 100.00% (0/0) | 100.00% (2/2) |
| src/core/FundFactory.sol | 95.35% (41/43) | 96.15% (50/52) | 100.00% (9/9) | 100.00% (7/7) |
| src/core/LockgateCreditLine.sol | 99.20% (124/125) | 94.95% (188/198) | 85.00% (51/60) | 100.00% (11/11) |
| src/core/LockgateExitPool.sol | 89.09% (49/55) | 86.76% (59/68) | 61.54% (8/13) | 72.73% (8/11) |
| src/core/MockUSDG.sol | 100.00% (19/19) | 89.47% (17/19) | 60.00% (3/5) | 100.00% (5/5) |
| src/core/OpenCreditVault.sol | 87.69% (57/65) | 84.71% (72/85) | 57.14% (8/14) | 90.91% (10/11) |
| src/core/PlatformBase.sol | 90.22% (166/184) | 84.47% (185/219) | 52.38% (22/42) | 89.29% (25/28) |
| src/core/PlatformReserve.sol | 100.00% (53/53) | 90.16% (55/61) | 57.14% (8/14) | 100.00% (10/10) |
| src/core/PlatformShare.sol | 90.91% (20/22) | 88.00% (22/25) | 66.67% (4/6) | 87.50% (7/8) |
| src/core/PlatformStore.sol | 90.16% (55/61) | 91.67% (66/72) | 82.35% (14/17) | 72.73% (8/11) |
| src/core/PricingEngine.sol | 100.00% (32/32) | 90.57% (48/53) | 54.55% (6/11) | 100.00% (8/8) |
| src/core/PricingMath.sol | 98.15% (53/54) | 98.95% (94/95) | 100.00% (18/18) | 100.00% (11/11) |
| src/core/QuarterlyWindowPlatform.sol | 80.00% (4/5) | 66.67% (2/3) | 100.00% (1/1) | 100.00% (2/2) |
| src/core/UsdgAdapter.sol | 100.00% (13/13) | 100.00% (16/16) | 100.00% (3/3) | 100.00% (4/4) |
| src/core/UsdgTransfers.sol | 100.00% (12/12) | 90.00% (18/20) | 50.00% (2/4) | 100.00% (2/2) |
| src/core/WeeklyCyclePlatform.sol | 100.00% (2/2) | 100.00% (1/1) | 100.00% (0/0) | 100.00% (1/1) |
| src/facility/CreditLineBook.sol | 100.00% (7/7) | 85.71% (6/7) | 0.00% (0/1) | 100.00% (3/3) |
| src/interfaces/AdvanceProposalLib.sol | 100.00% (8/8) | 100.00% (8/8) | 100.00% (0/0) | 100.00% (4/4) |
| Total | 94.34% (816/865) | 90.38% (1033/1143) | 70.42% (169/240) | 92.86% (156/168) |

## Known issues

The limit table in `SECURITY-NOTES.md` names a test for each row. The open items below are the ones an auditor should keep in view. The handoff repeats them.

- `draw` does not check an `AdvanceProposal` signature. `test_typehashAndDigestMatchCast`.
- There is no upgrade function and no parameter timelock. `setParams`, `setNav`, and `setGrace` apply on the next call. An open advance keeps the fee, principal, due date, and grace stored at draw. `test_paramChangeLeavesTheOpenAdvance` `test_graceIsFixedAtDraw`.
- `feeFromBps` rounds up. The engine's token fee now rounds up too (2026-10-02). A 600-second quote on the constructor curve stays 99 bps. `halfUp` now multiplies in 512 bits. `../docs/SECURITY-NOTES-contracts.md` still says `PricingMath` is unchanged. That sentence is the 99 bps result.
- `requestWithdraw` reverts `Insolvent` when the burned shares' nav exceeds `assets`. A full 100e6 redeem succeeds. `test_vaultClaimWaitsAndFullRedeemFits` does not reach `Insolvent`.
- A slash can leave the posted reserve under `requiredReserve`. `invariant_reserveMatchesAdvances` allows that.
- `createPlatform` and `createDemoFund` are `onlyOwner` (Lockgate), so every limit and reserve bps through the factory is Lockgate-set. The earlier critical issue (anyone could register a platform with a huge limit and 0 reserve, raise NAV, and drain the line) is fixed. Regression `test/core/FactoryDrain.t.sol`. The issuer can still set NAV on its own platform, bounded by that limit and reserve. They post no cash. `repay` is permissionless.
- `OpenCreditVault` and `LockgateExitPool` are not deployed and superseded (door 2 moves investor positions). They remain only for unit tests and are marked `@custom:status NOT DEPLOYED, SUPERSEDED`.
- The utilization view floors. The draw gate rounds up. Outstanding 5000 and capital 5001 is view 4999 under a 5000 cap, and a principal of 1 reverts `UtilizationCap`. A cap of 5001 draws that unit and the view is 5000. Capital 0 with that outstanding reports 10000, and the quote is `"capital"`. `test_utilizationViewFloorsWhileTheNextUnitCeilsOver` `test_zeroCapitalReportsFullUtilizationAndQuotesCapital`
- Epoch pro-rata floors can leave a unit the next epoch still cannot pay. Two claims of 3 against cash 5 preview as payable 4 and shortfall 2. Each holder receives 2. Cash left is 1, both requests stay queued at nav 1, and the next epoch pays 0. Two 1-share claims at nav 2 against cash 2 preview as payable 0 and shortfall 4. The window rolls and the dust stays queued. `test_epochProRataLeavesOneUnitAndBothStayQueued` `test_epochDustRollsAndQuarterlyUngatePays`
- `withdrawCapital` can take the line's remaining token balance after a draw, while `earnedFees` is still 0. On a 100e6 advance that balance is 500,000e6 minus the 99,010,000 principal. One more unit reverts `CapitalShort`. A later repay of the face realizes the 990,000 fee. `test_ownerWithdrawsIdleWhileTheFeeIsUnrealized`
- Pause blocks `draw`, `withdrawCapital`, and `registerSource`. It does not block `repay`, `markLate`, `postReserve`, or an owner `depositCapital`.
- `IPartnerVault.payoutTo(address)` is declared on the partner interface at selector `0x63aec9af`. Core leaves that function on `src/partner/interfaces/IPartnerVault.sol`. The engine reads the partner vault. The earlier ask is closed in `INTERFACE-REQUESTS.md`.

Slither 0.11.6 was not re-run for this package. The recorded 2026-10-02 triage is 121 results, two fixed (factory constructor, `createDemoFund` force-approve), and 116 recorded as false positives or accepted timing checks in `../docs/SECURITY-NOTES-contracts.md`. Detector notes: <https://github.com/crytic/slither/wiki/Detector-Documentation>.

The coverage failure is a measurement limit of `--ir-minimum`. It is not a shipping EIP-170 breach. The shipping factory runtime is 4952 bytes, margin 19624.
