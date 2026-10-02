# Security notes — stage-1 core

## SUMMARY

This file is the trust model for `src/core`: who you have to trust, which roles the tests actually exercise, how pause and initialization behave, which limits stay open, and the threat model for each core contract. Every claim names a test under `test/core`. Run one from this directory:

```bash
FOUNDRY_PROFILE=core forge test --offline --match-test test_pauseBlocksDrawNotRepay
```

The whole core profile is `FOUNDRY_PROFILE=core forge test --offline`. Written 2026-10-02. This is not a pentest and not a legal opinion. The 2026-10-02 findings list and the Slither triage stay in `../docs/SECURITY-NOTES-contracts.md`. Partner, facility, engine, and harness notes stay beside that file. They are out of scope here.

A draw sends `navValue - fee` to the payee. The source owes `navValue`. `outstanding` is unpaid principal. `exposure` is unpaid nav. The fee is earned only as recovery passes the principal. On a 100e6 advance the slash of exactly 99,010,000 earns 0 and leaves the 990,000 fee late. The slash of 99,010,001 earns 1. `test_feeStartsOnTheUnitPastPrincipal` A source registered at 0 bps still goes `Late` for the whole face, with `earnedFees` 0 and `requiredReserve` 0. `test_emptyReserveStillMarksTheWholeFaceLate` After a 100e6 draw on the funded line the owner can withdraw the line's whole token balance, 500,000e6 minus 99,010,000, while `earnedFees` is 0 and the face is still owed. One more unit reverts `CapitalShort`. A later repay realizes the 990,000 fee. `test_ownerWithdrawsIdleWhileTheFeeIsUnrealized` Platform cash one unit above the first open remaining repays only that advance. The extra unit stays on the platform, and the queued holder is unpaid. `test_firstAdvanceClearsAndTheNextShortfallHoldsTheWindow` `eligibleOutstanding` and `lateOutstanding` are remaining nav, and they sum to `totalExposure`. The reserve floor is the higher of the live rate and the rate locked while that source is exposed. Required reserve is `ceil(exposure × active bps / 10000)`, or 0 when exposure or the active rate is 0.

## Trust assumptions

You trust the credit-line owner with capital, caps, grace, registrars, and pause. `renounceOwnership` on the line reverts `RenounceDisabled`, so repaid USDG still has an owner who can call `withdrawCapital`. Granting and then revoking a registrar and a slasher, clearing the reserve admin, and renouncing the reserve owner leave a 100e6 advance repayable by a stranger. The line owner then withdraws 500,000e6 plus the 990,000 fee, and the source withdraws its 20e6 reserve. `test_grantRevokeAndRenounceLeaveRepayAndCashReachable` A stranger who calls `registerSource` reverts `NotRegistrar`, and a stranger who calls `setSourceTerms` reverts `OwnableUnauthorizedAccount`. The owner can call both on an open source, and the source list stays one entry. `test_accessAndReregister` The owner's second `registerSource` on a source that is still registered emits `SourceUpdated` and does not emit `SourceRegistered` again. `test_ownerUpdateDoesNotEmitASecondRegistration` The owner's second `registerSource` is what changes the stored reserve rate: the test sets it to 500 bps. `test_registrarCannotRewriteAnOpenSource` After the owner deregisters a source, the factory registrar cannot register it again. `test_registrarCannotRestoreADeregisteredSource`

You trust the factory once the owner has enabled it as a registrar. `createPlatform` and `createDemoFund` are `onlyOwner`, so a non-owner call reverts `OwnableUnauthorizedAccount` and every limit and reserve bps comes from Lockgate. The owner-passed limit is stored and the call leaves the fund's token balance and reserve balance at 0. `test_createPlatformDoesNotSeedCash`

You trust a registered source's reported face. The line does not read the source's token balance. A stub draws 100e6, the investor receives 99,010,000, the source's exposure becomes 100e6, and `earnedFees` stays 0 until repayment. `test_drawPaysNetAndOwesFace`

You trust the source's nav timestamp and window. A future `navUpdatedAt` reverts `BadNavTime`. Age past the max reverts `StaleNav`. A due window reverts `WindowDue`. A gated source reverts `Gated` on `draw` and quotes `"gated"`. An unregistered source quotes `"unregistered"`. A zero face quotes `"zero"`. `test_quoteAndDrawGuards`

You trust the issuer of a sandbox fund with the live nav and the gate. A queued request keeps the nav stored at request time after the issuer calls `setNav`. `setNav(0)` reverts `ZeroAmount`. A gate blocks `requestRedeem` and still allows `deposit`. `test_gateBlocksRedeemNotDepositAndNavDoesNotRewriteTheQueue`

You trust the reserve admin that the platform named. The reserve owner cannot withdraw platform funds (`NotAdmin`). The named admin can. A slash pays the slasher, and a stranger's slash reverts `NotSlasher`. `test_postWithdrawFloorAndSlashTarget`

You trust whoever the owner has named as a slasher. In the core fixture that is the credit line, and its slash pays the line. After `lockSlasherSet`, another `setSlasher` reverts `SlashersLocked`, and a second `lockSlasherSet` reverts `SlashersLocked` too. `test_postWithdrawFloorAndSlashTarget` `test_lockSlashersAndCreditLineOnce` `test_strangerCannotCallOwnerControls` Anyone may `post` reserve for a source. That pull does not increase the line's token balance, and `accountedAssets` still equals `accountedEquity`. `test_postReservePassesThroughCreditLine`

You trust the pricing owner with the live curve. A stranger's `setParams` reverts `OwnableUnauthorizedAccount`. A broken curve, kink, scale, or year reverts `BadParams`. `test_setParamsGuards`

You trust MockUSDG only as a test token. The owner is a minter. A stranger's `mint` reverts `NotMinter` until the owner calls `setMinter`. `faucet` is open to anyone for 10,000e6 per call, and a second call succeeds. `test_mintAuth` `test_metadataAndFaucetCap`

The token must report 6 decimals. The adapter reverts `BadDecimals` on an 18-decimal token and `ZeroAddress` on the zero address. The Sepolia USDG address `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` cannot be wrapped with the mock flag. `test_rejectsWrongDecimalsAndZero` `test_canonicalSepoliaCannotBeMock`

Stage 1 does not take an `AdvanceProposal` on `draw`. A stub draw succeeds with no signature. The EIP-712 typehash and digest for domain `LockgateAdvance` version `1` are checked on their own in `test_typehashAndDigestMatchCast`. `test_drawPaysNetAndOwesFace`

There is no external price oracle on this book. Staleness is the source timestamp against the pricing engine: 7 days still quotes, and 7 days plus 1 second returns `"stale nav"` with 0 bps. A gated quote returns `"gated"`. `test_refusesAboveMaxAndStaleBoundary`

`draw`, and an open-vault `deposit`, revert `ReentrancyGuardReentrantCall` when the token calls back in. A failed callback draw leaves `advanceCount` at 0. A failed callback deposit leaves supply and assets at 0. `test_drawReentrancyReverts` `test_depositReentrancyReverts`

A short token delivery cannot fund the reserve or leave the line. Reserve `post` of a 10% skim reverts `FeeOnTransfer` for 10e6 against 9e6 received. A taxed `transfer` on `withdrawCapital` reverts the same way and leaves equity unchanged. `test_feeOnTransferCannotFundReserve` `test_pushRejectsAShortDelivery`

## Privileged roles

| Who | What the tests show | Test |
| --- | --- | --- |
| Credit-line owner | Re-registers an open source, sets terms, and is the only caller who gets past `NotRegistrar` | `test_accessAndReregister` |
| Credit-line owner | Pauses the line | `test_pauseBlocksDrawNotRepay` |
| Credit-line owner | Sets utilization and concentration caps, and withdraws free capital | `test_limitReserveUtilConcentrationAndCapital` |
| Credit-line owner | Sets grace for a later draw | `test_graceIsFixedAtDraw` |
| Credit-line owner | Deregisters a source with zero exposure. A later draw reverts `Unregistered` until the owner registers it again | `test_deregisterBlocksUntilRegisteredAgain` |
| Credit-line owner | Cannot deregister a source that still has exposure (`StillExposed`) | `test_accessAndReregister` |
| Registrar | Cannot call `registerSource` again on a source that is already registered, or on one the owner has deregistered (`AlreadyRegistered`). Limit and reserve bps stay put | `test_registrarCannotRewriteAnOpenSource` `test_registrarCannotRestoreADeregisteredSource` |
| Anyone | Can `repay` an open advance. The caller receives none of the tokens. A second repay reverts `BadStatus` | `test_repayRealizesFeeAndAnyoneCanCall` |
| Anyone | A stranger can `markLate`. One second before `dueAt + graceOf(id)` reverts `TooEarly`, and the call at that instant succeeds | `test_partialSlashThenCureStaysLate` `test_graceBoundaryAndFullSlash` |
| Anyone | Can `postReserve` through the line into a source's reserve balance. `ReservePosted` names that caller. The reserve's `Posted` names the line | `test_postReservePassesThroughCreditLine` `test_postReserveNamesThePayer` |
| Reserve owner | Cannot withdraw a platform balance (`NotAdmin`). Cannot name a slasher of the zero address. A stranger cannot name an admin (`NotPlatform`) or a slasher | `test_postWithdrawFloorAndSlashTarget` `test_onlyPlatformNamesAdmin` |
| Reserve owner | `setCreditLine` a second time reverts `AlreadySet`. After `lockSlasherSet`, `setSlasher` and a second `lockSlasherSet` revert `SlashersLocked` | `test_lockSlashersAndCreditLineOnce` `test_strangerCannotCallOwnerControls` |
| Platform | Names its reserve admin. That admin withdraws. The reserve owner does not | `test_postWithdrawFloorAndSlashTarget` |
| Issuer | `createPlatform` and `createDemoFund` attribute the fund to the issuer argument the owner passes (zero reverts `ZeroAddress`). The issuer can set NAV on its own platform, bounded by Lockgate's limit and reserve | `test_createPlatformDoesNotSeedCash` `test_demoSeedAndExitClearsOnTheWindow` |
| Issuer | Sets the gate and the nav. `QueueKind.None` reverts `BadKind` | `test_gateBlocksRedeemNotDepositAndNavDoesNotRewriteTheQueue` `test_shareNeedsAllowlistAndFactoryRejectsBadConfig` |
| Factory owner | `setDemoWindow(0)` reverts `BadParam`. A factory whose adapter is not a mock reverts `DemoRequiresMock` on `createDemoFund` | `test_shareNeedsAllowlistAndFactoryRejectsBadConfig` `test_realAdapterCannotMintTheDemo` |
| Pricing owner | `setParams` is owner-only, and the guards above reject a broken curve | `test_setParamsGuards` |
| Exit-pool owner | `setGated(true)` makes `sellToLockgate` revert `Gated`. The quote returns `"gated"` | `test_gateSlippageAndLateSettle` |
| Vault owner | A stranger cannot `setCooldown` or `setGated`. `setCooldown(0)` reverts `BadParam` | `test_accessZeroAndRealTokenDoesNotMintYield` |
| MockUSDG owner | Grants `mint`. `mint` to the zero address reverts `ZeroAddress` | `test_mintAuth` |
| Share holder | `transfer` to an address the issuer has not allowlisted reverts `NotAllowlisted`. After `setAllowlist`, the transfer succeeds | `test_shareNeedsAllowlistAndFactoryRejectsBadConfig` |

`processWindow` has no role check. The issuer, or anyone else, can call it once the window is open. Calling it early reverts `WindowClosed`. `test_exitNowRepaysOnTheWindowAndQueuedNavStaysLocked`

## Upgrade and pause

There is no upgrade function and no parameter timelock. `setParams` is immediate for the next quote. An advance that is already open keeps the fee, principal, due date, and grace stored at draw. Repaying it still realizes that stored fee. A later draw stores the new curve. In the test the open 100e6 advance stays at 990,000, `timeScale` moves from 4320 to 1 with `minFeeBps` 0, and the next draw stores a fee of 0. `test_paramChangeLeavesTheOpenAdvance`. Grace has the same shape. `test_graceIsFixedAtDraw`

The initialization lock is what the tests check in place of an upgrade. `createPlatform` returns a clone. A second `initialize` on that clone reverts `BadConfig`. The same call on `weeklyImpl` reverts `BadConfig`. The factory constructor reverts `ZeroAddress` if the adapter, the credit line, the reserve, or any of the three implementations is the zero address. `test_initializeIsOnceOnTheCloneAndTheImplementation` `test_constructorRejectsZeroAddresses` `test_freshCloneRejectsAZeroField`

The reserve credit line is write-once. The slasher set can be frozen, and the freeze holds. `test_lockSlashersAndCreditLineOnce`

Pause is an owner switch on the credit line. The tests cover these paths:

| While paused | Result | Test |
| --- | --- | --- |
| `quote` | Returns `"paused"` | `test_pauseBlocksDrawNotRepay` |
| `draw` | Reverts `EnforcedPause` | `test_pauseBlocksDrawNotRepay` |
| `withdrawCapital` | Reverts `EnforcedPause` | `test_feeTooHighUnknownAdvanceAndPausedWithdraw` `test_pauseStillAcceptsCapital` |
| `repay` | Runs. The fee is realized | `test_pauseBlocksDrawNotRepay` |
| `markLate`, `postReserve` | Run. Pause does not shrink `eligibleOutstanding` | `test_pauseStopsDrawsAndLeavesEmergencyCollection` |
| `depositCapital` | The owner can add capital. A stranger reverts `OwnableUnauthorizedAccount` | `test_pauseStillAcceptsCapital` |
| `unpause` | Owner-only. A stranger reverts `OwnableUnauthorizedAccount`. A covered draw then succeeds | `test_pauseStopsDrawsAndLeavesEmergencyCollection` |
| `pause`, then `unpause`, with advances still open | Eligible stays 100e6, late stays 25e6, exposure stays 125e6, required reserve stays 9,375,000, and the stored fee, due date, and grace stay put. A further day past grace leaves the open advance `Active` | `test_pauseAndResumeLeaveTheOpenBook` |

A sandbox gate is separate from that pause. On a quarterly fund, `setGated(true)` makes `processWindow` revert `WindowGated` until the issuer clears it. On a weekly fund, the same flag does not stop `processWindow`. `test_quarterlyGateFreezesSettlementWeeklyGateDoesNot` `test_epochDustRollsAndQuarterlyUngatePays`

The exit pool's gate blocks a new sale and does not settle an existing one by itself. `test_gateSlippageAndLateSettle`

## Known limitations

| Limit | What stays true | Test |
| --- | --- | --- |
| Reported face | The line pays from its own capital against the source's reported nav. It does not match that figure to cash in the source | `test_drawPaysNetAndOwesFace` |
| Factory registration | `createPlatform` is `onlyOwner`. An attacker self-registering with a huge limit and 0 reserve (the old critical drain) reverts `OwnableUnauthorizedAccount`. Owner-set limit and reserve bound a marked-up NAV. It posts no cash and no reserve. A platform created with reserve bps 0 still accepts deposits and queues up to `MAX_OPEN` | `test_createPlatformDoesNotSeedCash` `test_openQueueCapsAndDropsSettledHistory` `test/core/FactoryDrain.t.sol` |
| Reserve floor | Lowering the live rate while exposure is open leaves `reserveFloorBps` in place. A 100e6 draw at 750 bps still requires 7,500,000. Withdrawal of that balance reverts `ShortReserve`. Repayment to zero exposure drops the floor to the new live rate | `test_openExposureKeepsTheReserveFloor` `test_loweredRateKeepsTheOpenFloor` |
| Grace | `setGrace` does not change `graceOf` on an advance already drawn. A later draw stores the new grace. Grace 0 can be marked late at `dueAt` | `test_graceIsFixedAtDraw` `test_zeroUtilizationBlocksAndGraceZeroIsDue` |
| Params | The owner can change `minFeeBps` and `timeScale` and the next draw sees the new values. An open advance keeps its stored fee. In the reserve test, `minFeeBps` is 0 and `timeScale` is 1, a 1-unit draw is short reserve until 1 unit is posted, and `requiredReserve` is then 1 | `test_paramChangeLeavesTheOpenAdvance` `test_requiredReserveRoundsUpFromOneUnit` |
| Idle fee cash | After a 100e6 draw the owner withdraws `accountedEquity() - outstanding()` and the books still match. Repayment later realizes the 990,000 fee | `test_walkDrawWithdrawRepayAndSlash` |
| Donations | Tokens sent straight to the line do not raise `accountedEquity` and cannot be withdrawn as capital | `test_donationIsNotWithdrawableEquity` |
| Late status | A full slash sets status `Late` with remaining 0 and `lateOutstanding` 0. A partial slash that is later repaid stays `Late` after remaining hits 0 | `test_graceBoundaryAndFullSlash` `test_partialSlashThenCureStaysLate` |
| Permissionless repay | Anyone who calls `repay` pulls the remainder from the source, which has approved the line | `test_repayRealizesFeeAndAnyoneCanCall` |
| Caps round up | A utilization cap of 0 rejects a 1e6 draw. Outstanding 5000 and capital 5001 is view 4999. A 5000 cap rejects the next principal of 1. A 5001 cap draws it and the view is 5000. Capital 0 with that outstanding reports 10000 and the quote is `"capital"`. Concentration at exactly 5,000 bps passes. One unit over that cap reverts `ConcentrationCap` | `test_zeroUtilizationCapRejectsOneUnit` `test_utilizationViewFloorsWhileTheNextUnitCeilsOver` `test_zeroCapitalReportsFullUtilizationAndQuotesCapital` `test_concentrationRoundsUp` `test_secondSourceCannotTakeTheWholeBook` |
| Open-request cap | The 129th open request reverts `QueueFull`. `processWindow` clears the open list. Settled ids stay in `requestCount` and drop off `firstOpen` | `test_openQueueCapsAndDropsSettledHistory` |
| Repay before investors | If the open advance does not fit in the window, `currentCycleId` stays put and a queued request stays queued. The window rolls after the advance is repaid | `test_repayFirstBeforeQueueAndUnpaidAdvanceDoesNotRoll` |
| Late or missed queue | A 1-unit cash balance does not repay a 100e6 advance or pay the queued investor. After grace the slash takes the 7,500,000 reserve and leaves `requiredReserve` at 6,937,500 against a 0 balance. Cash that arrives later repays the 92,500,000 shortfall, realizes the 990,000 fee, drops the requirement to 0, and only then pays the queue. One roll does not catch a day of lateness, so the next quote is still `"window due"` | `test_missedWindowSlashesReserveAndHoldsTheQueue` `test_lateCashRepaysTheLineThenPaysTheQueue` |
| Advanced exits | `cancel` on an advanced request reverts `BadStatus`. The shares stay escrowed until the window repays the line | `test_exitNowRepaysOnTheWindowAndQueuedNavStaysLocked` |
| Epoch dust | Pro-rata that buys nothing leaves the requests queued and rolls the cycle. Cash can sit below `queuedValue`. Preview is payable 0 and shortfall 4 | `test_epochDustRollsAndQuarterlyUngatePays` |
| Epoch floor | Two claims of 3 against cash 5 each receive 2. Preview is payable 4 and shortfall 2. Cash left is 1, both stay queued at nav 1, and the next epoch pays 0 | `test_epochProRataLeavesOneUnitAndBothStayQueued` |
| Door 2 reserve (removed: not deployed) | The exit pool is registered at 0 bps. A 100e6 sale requires 0 reserve, charges 490,000 (49 bps over the 5-minute cooldown), and `settle` before `readyAt` reverts `NotReady` | `test_sellThenSettleRepaysTheFace` |
| Door 2 after late (removed: not deployed) | `markLate` on the pool's advance, then `settle`, clears `lateOutstanding` and leaves the advance `Late` | `test_gateSlippageAndLateSettle` |
| Mock yield | With minting on, one year accrues 9% (100e6 becomes 109e6). With minting off, a year of `accrue` leaves assets and the token balance unchanged | `test_oneYearOfMockYieldIsNinePercent` `test_accessZeroAndRealTokenDoesNotMintYield` |
| Fee rounding | `feeFromBps(1, 1)` is 1. `feeFromBps(10_001, 750)` is 751. Ceil is half-up, or one unit above it when the remainder is below half. `halfUp(type(uint256).max, 2, 4)` is `2^255`. A zero denominator reverts. `feeFromBps(type(uint256).max, 10001)` reverts because the fee does not fit | `test_oneUnitRoundsUp` `testFuzz_ceilIsHalfUpOrOneMore` `test_zeroDustMaxUintAndRoundingDirection` `test_halfUpRevertsOnZeroDenominator` `test_feeFromBpsRevertsWhenCeilDoesNotFit` |
| Demo approve | `createDemoFund` uses `forceApprove`. A token whose `approve` returns false for the reserve reverts `SafeERC20FailedOperation` and leaves `allFunds` and `sources` empty | `test_demoFundRejectsAFalseApprove` |
| Open-vault `Insolvent` | `requestWithdraw` reverts `Insolvent` when `shares * nav / 1e18` exceeds `assets`. A full redeem of a 100e6 deposit still fits: assets and supply hit 0, and `claim` pays 100e6. That test does not reach `Insolvent` | `test_vaultClaimWaitsAndFullRedeemFits` |
| Unknown ids | `repay` and `markLate` on id 0 revert `UnknownAdvance`. A draw whose priced fee exceeds `maxFee` reverts `FeeTooHigh` | `test_feeTooHighUnknownAdvanceAndPausedWithdraw` |

The three core invariants are part of this model. `invariant_bookAndReserveBalance` checks `accountedAssets == accountedEquity`, reserve token balance against `totalBalances`, assets against `outstanding`, and `eligibleOutstanding + lateOutstanding == totalExposure`. `invariant_queueEscrowAndBook` checks queued count, queued value, escrowed shares, and that the open list is exactly the live requests. `invariant_reserveMatchesAdvances` rebuilds exposure, unpaid principal, earned fees, the two buckets, and each source's reserve floor from the advances. A late advance may have remaining 0. A slash may leave the posted reserve under the floor, so the invariant does not require `balanceOf >= requiredReserve`.

`invariant_bookAndReserveBalance` `invariant_queueEscrowAndBook` `invariant_reserveMatchesAdvances`

## Threat model

Each row is one attacker, the asset they can reach, the call they use, what the contract does about it, and the test that locks that behavior. `PlatformConfig` is a struct with no functions. `UsdgAdapter` stores its token in the constructor and has no admin call. `PricingMath` and `UsdgTransfers` are libraries. `WeeklyCyclePlatform`, `EpochQueuePlatform`, and `QuarterlyWindowPlatform` add no admin of their own. The deposit ban and the window event are on `PlatformBase`. On a fresh clone, a zero nav, interval, token, credit line, or issuer reverts `BadConfig` and leaves `issuer` unset. A valid `initialize` then sticks, and a second call reverts `BadConfig`. `test_freshCloneRejectsAZeroField`

### CreditLineAdmin

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Stranger | Capital, source terms, pause | `registerSource`, `setSourceTerms`, `withdrawCapital`, `pause` | A stranger reverts `NotRegistrar` or `OwnableUnauthorizedAccount`. The owner can re-register an open source. A registrar cannot, including after `deregisterSource` | `test_accessAndReregister` `test_registrarCannotRewriteAnOpenSource` `test_registrarCannotRestoreADeregisteredSource` |
| Owner lowering the live rate | First-loss reserve on an open advance | `setSourceTerms` | `reserveFloorBps` stays at the higher rate while exposure is open. Withdrawing that balance reverts `ShortReserve`. Exposure of 0 drops the floor to the live rate | `test_openExposureKeepsTheReserveFloor` `test_loweredRateKeepsTheOpenFloor` |
| Anyone sending tokens straight to the line | Withdrawable equity | A raw token transfer | The donation does not raise `accountedEquity`, and `withdrawCapital` cannot take it | `test_donationIsNotWithdrawableEquity` |
| Owner, or a stranger racing the pause | New draws and free capital | `pause`, `unpause`, `depositCapital`, `withdrawCapital` | `withdrawCapital` reverts `EnforcedPause`. The owner can still `depositCapital`. A stranger's deposit reverts `OwnableUnauthorizedAccount` | `test_pauseStillAcceptsCapital` `test_pauseStopsDrawsAndLeavesEmergencyCollection` |
| Owner naming a zero registrar | Registrar set | `setRegistrar` | The call reverts `ZeroAddress` and `registrars(address(0))` stays false | `test_strangerCannotMoveSharesOrIssuerControls` |

### LockgateCreditLine

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Registered source | Line capital | `draw` | The payee receives `navValue - fee`. The source owes the face. The line does not read the source's cash balance | `test_drawPaysNetAndOwesFace` `test_setNavAboveCashStillDrawsTheLine` |
| Owner renouncing the line, or revoking a registrar, slasher, or reserve admin | Repaid USDG and posted reserve | `renounceOwnership`, `setRegistrar`, `setSlasher`, `setAdmin` | The line owner cannot renounce. After the other role changes a stranger still repays the face, the owner withdraws principal plus fee, and the source withdraws the posted reserve | `test_grantRevokeAndRenounceLeaveRepayAndCashReachable` |
| Owner | Idle line cash while a fee is unearned | `withdrawCapital` | After a 100e6 draw the owner can withdraw the whole token balance. `earnedFees` stays 0 and the face stays owed. One more unit reverts `CapitalShort`. A later repay realizes the 990,000 fee | `test_ownerWithdrawsIdleWhileTheFeeIsUnrealized` |
| Source whose balance is 1 short, or one advance among several | Book state and the other advances | `repay` | The short pull reverts and the recovery rolls back. Clearing one advance leaves the other active at its full face | `test_partialRepaymentClearsOneAdvance` `test_concurrentAdvancesStayIndependent` |
| Source that posts only the reserve for the open face | The next draw, then the shortfall | `draw`, `markLate` | A further 1e6 draw reverts `ReserveShort`. After grace, the slash moves the unpaid face to `lateOutstanding` | `test_reserveExhaustionLeavesTheShortfallLate` |
| Anyone before the stored grace | Reserve | `markLate` | The call reverts `TooEarly` until `dueAt + graceOf(id)`. `setGrace` does not shorten an advance already drawn | `test_graceBoundaryAndFullSlash` `test_graceIsFixedAtDraw` |
| Reentering token, or a second source over the cap | Advance records and book share | `draw` | The callback reverts `ReentrancyGuardReentrantCall` and leaves `advanceCount` at 0. Concentration above the cap reverts `ConcentrationCap` | `test_drawReentrancyReverts` `test_secondSourceCannotTakeTheWholeBook` |
| Anyone while the line is paused | Eligible book | `draw`, `markLate`, `repay`, `pause`, `unpause` | `draw` reverts `EnforcedPause`. Pause and unpause leave eligible, late, exposure, and the stored advance in place. `markLate` and `repay` still run | `test_pauseAndResumeLeaveTheOpenBook` `test_pauseStopsDrawsAndLeavesEmergencyCollection` |
| Source whose window is past `maxTenorSeconds` | Line capital | `draw` | At the default scale, 366 days quotes `"fee above max"` with fee 0 and bps 0. `feeBps` for that wait returns 1500. The draw reverts `FeeAboveMax`. One second later quotes `"tenor"` and reverts `Tenor`. `advanceCount` stays 0. With `timeScale` 1 the exact 366-day window draws at 1203 bps (fee 12,030,000 on 100e6), and one second past that still reverts `Tenor` | `test_tenorBoundaryRefusesTheDraw` |

### PlatformReserve

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Reserve owner or a stranger | A platform's posted reserve | `withdraw`, `slash`, `setAdmin` | `withdraw` reverts `NotAdmin`. `slash` reverts `NotSlasher`. A stranger's `setAdmin` reverts `NotPlatform` | `test_postWithdrawFloorAndSlashTarget` `test_onlyPlatformNamesAdmin` |
| Named reserve admin | Reserve below the required floor | `withdraw` | The call reverts `ShortReserve` when the balance would fall under `requiredOf`. An amount above the posted balance reverts `OverBalance` before that check | `test_requiredFloorBlocksWithdraw` `test_reserveZerosAndOverBalance` |
| Owner retargeting the book | Slasher set and the credit-line pointer | `setSlasher`, `setCreditLine`, `lockSlasherSet` | After `lockSlasherSet`, `setSlasher` and a second `lockSlasherSet` revert `SlashersLocked`. A second `setCreditLine` reverts `AlreadySet` | `test_lockSlashersAndCreditLineOnce` `test_strangerCannotCallOwnerControls` |
| Fee-on-transfer token | Reserve tokens versus `balanceOf` | `post` | A short delivery reverts `FeeOnTransfer` and does not raise the balance | `test_feeOnTransferCannotFundReserve` |

### PlatformStore

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Anyone flooding redemptions | Settlement work and the open list | `requestRedeem` | The 129th open request reverts `QueueFull`. Settlement walks the open list. Settled ids stay in `requestCount` and drop off `firstOpen` | `test_openQueueCapsAndDropsSettledHistory` |
| Anyone replaying configuration | Clone and implementation storage | `initialize` | A zero nav, interval, token, credit line, or issuer reverts `BadConfig` on a fresh clone. A second `initialize` reverts `BadConfig` on a configured clone and on the implementation | `test_freshCloneRejectsAZeroField` `test_initializeIsOnceOnTheCloneAndTheImplementation` |

### PlatformBase

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Investor who wants the queue paid before the line | Window cash | `processWindow` | If the open advance does not fit, `currentCycleId` stays put and the queued request stays queued. Cash one unit above the first remaining repays only that advance. The extra unit stays in platform cash, the next advance stays `Active`, and the cycle stays | `test_repayFirstBeforeQueueAndUnpaidAdvanceDoesNotRoll` `test_firstAdvanceClearsAndTheNextShortfallHoldsTheWindow` |
| Investor cancelling an advanced exit | Escrowed shares | `cancel` | An advanced request reverts `BadStatus`. The shares stay escrowed until the window repays the line | `test_exitNowRepaysOnTheWindowAndQueuedNavStaysLocked` |
| Issuer changing nav after a request | Queued face | `setNav` | The request keeps the nav stored at request time. `setNav(0)` reverts `ZeroAmount`. A gate blocks `requestRedeem` and still allows `deposit` | `test_gateBlocksRedeemNotDepositAndNavDoesNotRewriteTheQueue` |
| Anyone before the window | Settlement | `processWindow` | The call reverts `WindowClosed` | `test_exitNowRepaysOnTheWindowAndQueuedNavStaysLocked` |
| Stranger | Nav, the gate, and the allowlist | `setNav`, `setGated`, `setAllowlist` | Each call reverts `NotIssuer`. Nav and the gate stay as they were | `test_strangerCannotMoveSharesOrIssuerControls` |
| Stranger cancelling someone else's request | Escrowed shares | `cancel` | The call reverts `NotOwner`. The request stays queued and the shares stay on the platform. The investor who queued it can then cancel | `test_strangerCannotMoveSharesOrIssuerControls` |
| Investor exiting before any reserve is posted | Line capital | `exitEarly` | The call reverts `NotAvailable("reserve")` before slippage. The request stays queued and `advanceCount` stays 0 | `test_exitEarlyWithoutReserveStaysQueued` |

### WeeklyCyclePlatform

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Later, smaller redeem | Cash at the head of the queue | `processWindow` | FIFO pays a request that fits and leaves the next one queued. A head request that does not fit stays queued, and a later smaller request stays queued behind it. The cycle still rolls | `test_weeklyFifoPaysWholeRequestsAndDoesNotSkip` `test_fifoDoesNotSkipALaterSmallerRequest` |
| Issuer gate | A weekly settlement | `processWindow` | The weekly gate does not freeze settlement | `test_quarterlyGateFreezesSettlementWeeklyGateDoesNot` |
| Queue that pays late or never | Posted reserve, then the waiting investor | `processWindow`, `markLate` | A short cash balance leaves the cycle, the reserve, and the queued request in place. After grace the line slashes the posted reserve and the shortfall stays late. Later cash repays that shortfall before the queue is paid. The reserve balance stays 0 and the requirement falls to 0 only when exposure does | `test_missedWindowSlashesReserveAndHoldsTheQueue` `test_lateCashRepaysTheLineThenPaysTheQueue` |

### EpochQueuePlatform

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Investor expecting a whole-request payout | Cash left after the line is repaid | `processWindow` | Queued investors share that cash pro-rata. A share that buys nothing stays queued, and the cycle rolls. Two claims of 3 against cash 5 each receive 2, and the leftover unit stays through the next epoch | `test_epochPaysProRata` `test_epochDustRollsAndQuarterlyUngatePays` `test_epochProRataLeavesOneUnitAndBothStayQueued` |

### QuarterlyWindowPlatform

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Anyone settling while the issuer gate is on | Investor exits | `processWindow` | The call reverts `WindowGated` until the issuer clears the gate. Clearing it lets the window pay | `test_quarterlyGateFreezesSettlementWeeklyGateDoesNot` `test_epochDustRollsAndQuarterlyUngatePays` |

### PlatformShare

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Share holder | Shares moving to an address the issuer has not named | `transfer` | The transfer reverts `NotAllowlisted`. After the issuer's `setAllowlist`, the same transfer succeeds | `test_shareNeedsAllowlistAndFactoryRejectsBadConfig` |
| Banned holder | A new deposit, and a transfer of shares they already hold | `deposit`, `transfer` | `setAllowlist(account, false)` blocks a later deposit with `Blocked` and a transfer with `NotAllowlisted`. `requestRedeem` of the shares they already hold still queues | `test_issuerBanBlocksDepositAndStillLetsTheHolderQueue` |
| Stranger | Mint, burn, escrow pull, and the allowlist | `mint`, `burn`, `pull`, `setAllowlist` | Each call reverts `NotPlatform`. The issuer's `setAllowlist(address(0))` reverts `ZeroAddress` | `test_strangerCannotMoveSharesOrIssuerControls` |

### FundFactory

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Anyone but the owner | Line capital through a self-registered platform | `createPlatform`, `createDemoFund` | `onlyOwner`: reverts `OwnableUnauthorizedAccount`. The owner's call stores the owner-set limit and reserve bps and posts no cash and no reserve | `test_createPlatformDoesNotSeedCash` |
| Deployer | Wiring of the adapter, line, reserve, and implementations | Constructor | A zero adapter, credit line, reserve, weekly implementation, epoch implementation, or quarterly implementation reverts `ZeroAddress` | `test_constructorRejectsZeroAddresses` `test_freshCloneRejectsAZeroField` |
| Caller on a live adapter, or a token whose `approve` returns false | Demo mint and a half-registered fund | `createDemoFund` | A non-mock adapter reverts `DemoRequiresMock`. A false `approve` reverts `SafeERC20FailedOperation` and leaves `allFunds` and `sources` empty | `test_realAdapterCannotMintTheDemo` `test_demoFundRejectsAFalseApprove` |
| Caller passing `QueueKind.None`, or the owner passing a zero demo window | A fund deployment | `createPlatform`, `setDemoWindow` | `QueueKind.None` reverts `BadKind`. `setDemoWindow(0)` reverts `BadParam` | `test_shareNeedsAllowlistAndFactoryRejectsBadConfig` |

### PricingEngine

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Stranger, or an owner passing a broken curve | The live fee curve | `setParams` | A stranger reverts `OwnableUnauthorizedAccount`. A broken curve, kink, scale, or year reverts `BadParams` | `test_setParamsGuards` |
| Stale or gated source, or a window past the max tenor | A draw at a made-up fee | `feeCode`, `draw` | Age past the max returns `"stale nav"` and 0 bps. A gated quote is refused for every input the fuzz covers. One second past 366 days quotes `"tenor"`, and the draw reverts `Tenor` with the book unchanged | `test_refusesAboveMaxAndStaleBoundary` `testFuzz_gateRejectsEveryInput` `test_tenorBoundaryRefusesTheDraw` |

### PricingMath

Library. The credit line and `PricingEngine` are the callers.

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Caller rounding a fee down, or passing a product that does not fit | Token fee | `feeFromBps`, `halfUp` | `feeFromBps` rounds up. `feeFromBps(1, 1)` is 1. A fee that does not fit reverts. A zero denominator reverts | `test_oneUnitRoundsUp` `test_feeFromBpsRevertsWhenCeilDoesNotFit` `test_halfUpRevertsOnZeroDenominator` |

### UsdgAdapter

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Deployer | Unit scale of every balance the book reads | Constructor | An 18-decimal token reverts `BadDecimals`. The zero address reverts `ZeroAddress`. Sepolia USDG `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` with the mock flag reverts `CanonicalCannotBeMock` | `test_rejectsWrongDecimalsAndZero` `test_canonicalSepoliaCannotBeMock` |

### UsdgTransfers

Library. Reserve `post`, capital moves, vault deposits, and pushes are the callers.

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Fee-on-transfer token | Tokens actually received | `pull`, `push` | A short delivery reverts `FeeOnTransfer`. The reserve balance stays unchanged, and a taxed `withdrawCapital` leaves equity unchanged | `test_feeOnTransferCannotFundReserve` `test_pushRejectsAShortDelivery` |

### MockUSDG

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Stranger | Uncapped supply | `mint` | The call reverts `NotMinter` until the owner calls `setMinter`. `mint` to the zero address reverts `ZeroAddress` | `test_mintAuth` |
| Anyone | Per-call faucet | `faucet` | A call above 10,000e6 reverts `FaucetCap`. A second call at the cap succeeds. This token is a test double | `test_metadataAndFaucetCap` |

### OpenCreditVault (removed: not deployed, superseded; unit tests only)

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Reentering token | Share supply and `assets` | `deposit` | The callback reverts `ReentrancyGuardReentrantCall` and leaves supply and assets at 0 | `test_depositReentrancyReverts` |
| Stranger, or the owner setting a zero cooldown | Withdrawal timing | `setCooldown`, `claim` | A stranger's `setCooldown` reverts `OwnableUnauthorizedAccount`. `setCooldown(0)` reverts `BadParam`. `claim` before `readyAt` reverts `NotReady`. An unknown id reverts `UnknownWithdrawal`. A second claim reverts `AlreadyClaimed` | `test_accessZeroAndRealTokenDoesNotMintYield` `test_vaultClaimWaitsAndFullRedeemFits` |
| Vault deployed with `mintYield` false | Underlying balance | `accrue` | A year of `accrue` leaves assets, nav, and the token balance unchanged. With minting on, one year takes 100e6 to 109e6 | `test_accessZeroAndRealTokenDoesNotMintYield` `test_oneYearOfMockYieldIsNinePercent` |

### LockgateExitPool (removed: not deployed, superseded; unit tests only)

| Attacker | Asset | Entry point | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Seller while the pool is gated, or a seller naming a payout above the quote | Line capital | `sellToLockgate`, `setGated` | `setGated(true)` makes the sale revert `Gated` and the quote return `"gated"`. A stranger's `setGated` reverts `OwnableUnauthorizedAccount`. `minUsdgOut` above the quote reverts `Slippage`. A paused credit line reverts `NotAvailable("paused")` and leaves the shares with the seller | `test_gateSlippageAndLateSettle` `test_accessZeroAndRealTokenDoesNotMintYield` `test_pausedLineBlocksThePoolSale` |
| Anyone settling before the cooldown | Vault cash and the advance | `settle` | `settle` before `readyAt` reverts `NotReady`. A 100e6 sale at the 5-minute cooldown charges 490,000 and `settle` repays the face | `test_sellThenSettleRepaysTheFace` |
| Anyone marking the pool's advance late, then settling | Late book | `settle` after `markLate` | `settle` clears `lateOutstanding` and leaves the advance `Late` | `test_gateSlippageAndLateSettle` |

The three invariants above are the cross-contract check on these rows.
