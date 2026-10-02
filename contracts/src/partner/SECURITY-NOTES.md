# Security notes — partner vault

## SUMMARY

This file is the trust model for `contracts/src/partner`: who you have to trust, which roles the tests exercise, and how pause, initialization, and upgrade behave. Every claim names a test under `contracts/test/partner`. The 2026-10-02 findings list stays in `docs/SECURITY-NOTES-partner.md`. The credit facility is in that findings list. It is outside this file.

Run one test from `lockgate/repo/contracts`:

```bash
FOUNDRY_SRC=src/partner FOUNDRY_TEST=test/partner forge test --offline --match-test test_lockgateCannotAdministerOrWithdraw
```

The high run on 2026-10-02 was:

```bash
FOUNDRY_FUZZ_RUNS=10000 FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_SRC=src/partner FOUNDRY_TEST=test/partner forge test --offline
```

That run passed 72 tests, with 0 failures and 0 skips, across 18 suites. Each fuzz test ran 10,000 times. `invariant_solvencyAndLockgateHasNoClaim` ran 256 times, 6,400 calls, 0 reverts. The suite default in `foundry.toml` remains 256 fuzz runs and 40 invariant runs. This is not a pentest and not a legal opinion. The default suite, after `test/partner/Gas.t.sol`, `test/partner/Token.t.sol`, `test/partner/WindDown.t.sol`, `test/partner/Queue.t.sol`, `test/partner/Calls.t.sol`, `test/partner/FeeDust.t.sol`, `test/partner/Grief.t.sol`, `test/partner/Reverts.t.sol`, `test/partner/Symmetry.t.sol`, `test/partner/MaxNav.t.sol`, and `test/partner/ExitRepay.t.sol`, is the Handoff in `contracts/src/partner/README.md`. The 72-test count is this high run, and it predates those files.

`navValue` is what the platform owes back. The fee sits inside that nav. The vault requires `payout` to equal `navValue - fee`. Exposure is unpaid nav. `outstandingPrincipal` is the cash that left.

## Trust assumptions

You trust the vault owner with the cash, the mandate, pause, the oracle, the grace stored on the next advance, the upgrade schedule, and the address stored as `autoModule`. A stranger's `deposit`, `withdraw`, `setMandate`, `cancel`, and `writeOff` revert `Unauthorized`. The owner stays the partner, and the posted reserve stays 50,000e6. `test_strangerCannotGovernOrTakeReserve`

You trust the owner to name the engine proposer. The engine signature does not move cash by itself. `submitProposal` from Lockgate leaves idle cash and the token balance unchanged, and `nonceUsed` stays false. The following `execute` reverts `NotApproved`. Lockgate's token balance stays 0. `test_engineSignatureAloneDoesNotPay`

You trust the partner signer the owner names, and an ERC-1271 wallet at that address. The signer can `execute`. After `setPartnerSigner(address(0))` the same key reverts `NotApproved`, `advanceCount` stays 1, and the signer holds 0 tokens. `test_revokedSignerCannotExecute` `approve` is the owner or that signer, and only for a digest `submitProposal` already stored. A wrong partner signature reverts `NotApproved`. After the wallet allows the digest, `execute` pays the platform and Lockgate's balance stays 0. `test_submitThenApproveAndErc1271`

You trust the contract stored at `autoModule` to be the partner's robot. The vault accepts that address as partner authorisation and does not read the module's bounds. Inside `AutoApproveModule`, a stranger's `setBounds` reverts `Unauthorized`. The module's `withdraw` on the vault reverts `Unauthorized`. Nav above the cap, a fee one unit under the floor, a tenor past the cap, and a second advance that breaks the daily limit revert `BoundsExceeded`. A relayer who calls `execute` inside the bounds receives 0 tokens. `test_autoModuleCannotExceedPartnerBounds` A proposal at 500 bps, and a fee of `nav - 1`, revert `BoundsExceeded`. A 100 bps proposal funds, and the recipient is the platform. `test_moduleCapsTheFee` With the allowlist on, `execute` reverts `BoundsExceeded` until `setPlatformAllowed`. A second 100,000e6 advance in the same window reverts `BoundsExceeded`. One day later the same size executes. `setBounds` with `enabled` false makes the next call revert `Disabled`. `test_autoModuleAllowlistAndDailyWindow` `setAutoModule(address(0))` makes the old module's `execute` revert `NotApproved`. `test_clearedModuleAndStrangerCannotRegister`

You trust an approved platform with the reserve posted in its name. The partner's `withdrawReserve` reverts `Unauthorized`. The platform withdraws down to `ceil(exposure * reserveBps / 10000)`. One unit past that reverts `MandateRejected(Reserve)`. On a nav of 10,000e6 + 1 at 500 bps, the required reserve is one unit above the floor. `test_shortFeeAndReserveCeilDoNotReleaseCash` A stranger's `withdrawReserve` reverts `Unauthorized` and the reserve stays 50,000e6. `test_strangerCannotGovernOrTakeReserve` After `setPlatform` revokes the platform, `postReserve` reverts `BadParam`. The advance already open still repays to owed 0. `test_revokedPlatformAndExpiredMandateBlockTheNextAdvance`

You trust the mandate the owner stored. A revoked platform makes the next `execute` revert `MandateRejected(Platform)`. An expiry of 1, read after a warp to timestamp 2, reverts `MandateRejected(MandateExpired)`. `test_revokedPlatformAndExpiredMandateBlockTheNextAdvance` Concentration 0 previews `Concentration`. An expiry of 0 previews `MandateExpired`. `test_zeroExpiryAndZeroConcentrationBlock` For any nav from 1e6 up to idle and any fee from 1 to 9,999 bps, the floor fee previews `None` and one unit under that floor previews `Fee`, when the floor is between 1 and `nav - 1`. `testFuzz_feeFloor` A signed fee of `floor - 1` on nav 10,000e6 + 1 reverts `MandateRejected(Fee)` and the vault token balance does not move. `test_shortFeeAndReserveCeilDoNotReleaseCash`

You trust the oracle and the gate the owner turned on. A `latest()` word that does not fit a timestamp previews `StaleOracle`, and `execute` reverts `MandateRejected(StaleOracle)`. `test_wideOracleFailsClosed` A gate flag other than 0 previews `Gated`. `test_dirtyGateFailsClosed`

You trust `graceOf(id)` on an advance that is already funded. `setGrace(0)` leaves that advance at 1 day and sets `grace()` to 0. `markLate` at `dueAt` reverts `TooEarly`. The next advance stores 0. `test_shorteningGraceDoesNotSlashEarly` `markLate` one second before `dueAt + grace()` reverts `TooEarly`. At that instant the status becomes `Late`, and a second `writeOff` reverts `BadStatus`. `test_earlyMarkLateThenWriteOff`

You trust pause to block a new advance and to leave repayment open. `execute` while paused reverts `MandateRejected(Paused)`. `repay` on the open advance sets the status to `Repaid`. `test_pauseBlocksNewAdvancesAndRepayStillClears`

The EIP-712 domain is `LockgateAdvance` version `1`, bound to this vault and `block.chainid`. The same signature on a second vault reverts `BadEngineSig`. After `vm.chainId(block.chainid + 1)` the original vault reverts `BadEngineSig`. `test_signatureIsBoundToVaultAndChain` The digest for the pinned vector matches viem. `test_digestAndQuoteIdMatchViem` An `expiresAt` equal to the current timestamp previews `None`. One second earlier previews `Deadline`. A second `execute` of a funded proposal reverts `NonceUsed`. `cancel` then `execute` reverts `NonceUsed`. `test_deadlineAndNonceAndCancel`

A token that delivers short of the pulled amount cannot fund the vault. A 1,000e6 deposit of a fee-on-transfer token reverts `BalanceMismatch`. `test_feeOnTransferDepositReverts` Pulls and pushes revert `BalanceMismatch` unless the vault balance matches idle plus reserve and the counterparty moves by the full amount. A fee, a yank, a deficit, or an unskimmed surplus leaves the books unchanged. A false return reverts `SafeERC20FailedOperation`. A hook on deposit, repay, post reserve, and `relayRepay` cannot take a second payment. `test_feeOnTransferRejectsPullsAndPushes` `test_returnFalseMovesNoCash` `test_rebaseDownBricksUntilRestoredAndSurplusNeedsSkim` `test_reentrantHookCannotDoubleSpend` `test_relayRepayRejectsFeeYankAndReentrantRouter` On `execute`, a token callback into `withdraw` and into `execute` reverts `ReentrancyGuardReentrantCall`. The platform receives the payout once and `advanceCount` is 1. `test_reentrancyPaysOnce` A reentrant `withdraw` pays the sink once and idle falls by that one payment. `test_withdrawReentrancyPaysOnce`

You trust the router as a directory with no owner and no sweep. `register` requires `vault.owner() == msg.sender`. Lockgate's `register` reverts `NotOwner`. A quote whose recipient is Lockgate returns no slice, and the router token balance stays 0. `test_lockgateCannotRegisterOrDivertTheQuote` A stranger's `register` reverts `NotOwner` and `vaultCount` stays 0. `test_clearedModuleAndStrangerCannotRegister` `relayRepay` pulls from the caller and leaves the router balance at 0. The vault that funded the exit is the one whose owed balance hits 0. The other vaults' idle cash does not move. `test_repayReturnsOnlyToTheFundingVault` Thirty-two advances of 10,000e6, with sixteen repaid, leave a 100,000e6 partner withdrawal and the other platform's repayment within 25,000 gas of a vault that holds only that other advance. Idle ends at 1,744,200e6. Sixteen advances stay owed 10,000e6. `test_tinyAdvancesDoNotBlockAnotherWithdrawalOrRepayment` Thirty-two records on one exit leave `relayRepay` of another exit, and repayment of the last record, inside that slack. The router balance ends at 0. `test_manyExitRecordsDoNotTaxAnotherRepayment`

A stage-1 quote is not a vault advance. On a 10,000e6 face the line quotes 99 bps and a fee of 99e6. The vault previews that fee as `Fee`. Vault idle and the line's token balance stay put. `test_stage1QuoteDoesNotSpendTheVault` A later partner `execute` of 4,000e6 leaves the line's `eligibleOutstanding` and `capital` unchanged. `test_g6SubmitAndPartnerExecuteStayOffTheCreditLine`

## Privileged roles

| Who | What the tests show | Test |
| --- | --- | --- |
| Vault owner | Deposits, withdraws, skims, and is the only address whose `sharesOf` equals `totalShares` | `test_twoStepOwnershipMovesTheShares` `invariant_solvencyAndLockgateHasNoClaim` |
| Vault owner | Sets the proposer, signer, module, router, oracle, grace, pause, mandate, platform, and payout. Lockgate's calls revert `Unauthorized` and Lockgate's balance stays 0 | `test_lockgateCannotAdministerOrWithdraw` |
| Vault owner | Schedules and executes an upgrade. Lockgate's `scheduleUpgrade` reverts `Unauthorized` | `test_partnerTimelockedUpgrade` |
| Vault owner | Starts a two-step transfer. Until `acceptOwnership`, the owner and the shares stay put. Lockgate's `acceptOwnership` reverts `Unauthorized` | `test_twoStepOwnershipMovesTheShares` |
| Vault owner | `cancel` burns a nonce. `writeOff` is owner-only and sends no tokens to the caller | `test_deadlineAndNonceAndCancel` `test_lateSlashThenWriteOffRemovesPrincipal` |
| Partner signer | `execute` and `approve`. Clearing the signer removes that power | `test_revokedSignerCannotExecute` `test_submitThenApproveAndErc1271` |
| Auto-approve module | `execute` with an empty partner signature while the owner has set that address | `test_autoModuleCannotExceedPartnerBounds` `test_clearedModuleAndStrangerCannotRegister` |
| Module owner | `setBounds`, `setAllowlist`, and `setPlatformAllowed`. A stranger's `setBounds` reverts `Unauthorized` | `test_autoModuleCannotExceedPartnerBounds` `test_autoModuleAllowlistAndDailyWindow` |
| Caller with the engine signature | `submitProposal` from Lockgate moves no tokens. `nonceUsed` stays false | `test_engineSignatureAloneDoesNotPay` |
| Platform | `repay` clears an open advance while the vault is paused. A second `repay` reverts `BadStatus` | `test_pauseBlocksNewAdvancesAndRepayStillClears` `test_secondRepayReverts` |
| Caller | `markLate` from Lockgate, once `dueAt + graceOf(id)` has arrived, leaves Lockgate's token balance and the vault token balance unchanged | `test_markLateDoesNotPayTheCaller` |
| Platform | Posts reserve while it is approved. After the owner revokes it, `postReserve` reverts `BadParam`, and an open advance still repays to owed 0 | `test_revokedPlatformAndExpiredMandateBlockTheNextAdvance` `test_cashReserveAndBadWithdrawal` |
| Platform | Withdraws its reserve down to the ceil. The partner and a stranger revert `Unauthorized` | `test_shortFeeAndReserveCeilDoNotReleaseCash` `test_strangerCannotGovernOrTakeReserve` |
| Vault owner, on the router | `register` and `remove`. Lockgate and a stranger revert `NotOwner` | `test_lockgateCannotRegisterOrDivertTheQuote` `test_clearedModuleAndStrangerCannotRegister` |
| Anyone | Can `relayRepay` a recorded exit. The tokens land on the vault in that record | `test_repayReturnsOnlyToTheFundingVault` |
| Lockgate | Holds no vault role and no router role. As a recipient, `preview` is `Recipient` and the token balance stays 0 | `test_lockgateAsRecipientIsRejected` `test_lockgateCannotAdministerOrWithdraw` |

## Upgrade and pause

The implementation constructor locks initializers. `initialize` on that contract reverts `InvalidInitialization`, and the initializer slot stays `type(uint64).max`. `upgradeToAndCall` on the implementation reverts `UUPSUnauthorizedCallContext`. `test_secondInitializeRevertsAndAFailedInitDoesNotLock`

A fresh proxy starts at initializer version 0. `initialize` with a zero owner reverts `ZeroAddress`. A delay under one day reverts `BadParam`. The version stays 0, and a later `initialize` sets the owner, the asset, and grace. A second `initialize` on that proxy, and on the fixture vault, reverts `InvalidInitialization`. The owner and grace stay as first set. `test_secondInitializeRevertsAndAFailedInitDoesNotLock`

`upgradeToAndCall` and `executeUpgrade` from a stranger revert `Unauthorized`. The owner, before a schedule, reverts `UpgradeNotScheduled`, including a call aimed at `address(0)`. `proxiableUUID` on the proxy reverts `UUPSUnauthorizedCallContext`. After the delay, an upgrade whose calldata is `initialize` reverts `InvalidInitialization` and leaves version 1, the implementation, the owner, and idle cash in place. An empty upgrade to `PartnerVaultV2` reaches version 2 and keeps the owner, the asset, idle cash, and the shares. `test_unauthorizedUpgradeKeepsNamespacedStorage`

`executeUpgrade` one second before `scheduledEta` reverts `TooEarly`. `cancelUpgrade` clears `scheduledImpl`, and the next `executeUpgrade` reverts `UpgradeNotScheduled`. `increaseUpgradeDelay(1 days)` reverts `BadParam`. A delay of 2 days then reaches version 2 at the new eta. `test_upgradeTimelockCancelAndDelay` The same path through `executeUpgrade` keeps idle cash and the owner, and the vault token balance equals idle plus reserve. `test_partnerTimelockedUpgrade`

Pause is an owner switch. New funding stops. Repayment and wind-down stay open:

| While paused | Result | Test |
| --- | --- | --- |
| `execute` | Reverts `MandateRejected(Paused)` | `test_pauseBlocksNewAdvancesAndRepayStillClears` |
| `repay` | Runs. The status becomes `Repaid` | `test_pauseBlocksNewAdvancesAndRepayStillClears` |
| Wind-down with an open advance | Idle leaves. The required reserve stays until exposure clears. The fee returns to the partner. A write-off leaves the shortfall off the books and the token balance at 0. One-wei withdrawals still pay the last fee unit after shares hit 0 | `test_windDownWhileTwoAdvancesAreOpenLeavesNothing` `test_windDownWriteOffLeavesTheShortfallOffTheBooks` `test_oneWeiSweepsAfterRepayDoNotStrandTheFee` |

These notes do not cite an `unpause` test. The invariant also calls a handler that tries to fund while paused, and `mandateBreached` stays false. `invariant_solvencyAndLockgateHasNoClaim`

## Known limitations

| Limit | What stays true | Test |
| --- | --- | --- |
| Module address | The vault treats `msg.sender == autoModule` as partner authorisation. The fee ceiling lives in `AutoApproveModule`. These notes do not cite a test of a different contract installed at that address | `test_clearedModuleAndStrangerCannotRegister` `test_moduleCapsTheFee` |
| Stage-1 fee | The 600-second line quote on 10,000e6 is 99 bps. The vault floor rejects it and moves no cash | `test_stage1QuoteDoesNotSpendTheVault` |
| Books stay separate | A partner execute does not change the stage-1 eligible book or the line's capital | `test_g6SubmitAndPartnerExecuteStayOffTheCreditLine` |
| Grace | `setGrace` does not change `graceOf` on an advance already funded. Grace 0 on a later advance can be marked late at `dueAt` | `test_shorteningGraceDoesNotSlashEarly` |
| Payout desk | Once `setPayout` names a desk, the platform address previews `Recipient`. The desk receives `payout` | `test_payoutDeskIsTheOnlyRecipient` |
| Queue fee | The stage-1 99 bp quote, and a fee one unit under the vault floor, leave the request queued. Floor, half-up, 150 bps, and 250 bps fund the head and repay through the router. The line book stays put | `test_queueFundsAndRepaysAcrossFeeSettings` |
| Directory callback | `owner` and `getAdvance` are capped staticcalls. A state change reverts `NotOwner` or `Mismatch`. The vault stays listed once, a second vault is not planted, and no second repayment record is written | `test_registerReentryCannotListTheVault` `test_removeReentryCannotPlantAVault` `test_notifyReentryCannotPushASecondRecord` |
| Dirty owner word | An `owner` return above `uint160` reverts `NotOwner`. The directory stays empty | `test_dirtyOwnerWordRevertsNotOwner` |
| Quote return | A preview word above `uint8`, a preview return longer than one word, and an `idle` return longer than one word drop that vault. Best-fee and pro-rata still return the honest vault | `test_oddReturnsDoNotBlankTheQuote` |
| Repay balance drop | A clip that takes the router balance below the pre-pull balance reverts `BalanceMismatch`. The advance stays active. The router keeps the donated balance. The caller keeps the repayment | `test_relayRepayClipUnderDonationRevertsBalanceMismatch` |
| Donation | Tokens minted straight to the vault become idle when the owner calls `skim`. A 2-unit withdraw burns more shares than the floor ratio | `test_withdrawCeilFavorsTheVault` |
| Quote probes | A vault whose probe reverts, burns the gas cap, or reports a `maxNav` above `uint128` drops out. The honest vault is still quoted | `test_oneBadVaultDoesNotBlankTheQuote` |
| Replay | A funded nonce and a cancelled nonce both revert `NonceUsed` | `test_deadlineAndNonceAndCancel` |
| Repay once | The second `repay` reverts `BadStatus` | `test_secondRepayReverts` |
| Write-off once | `writeOff` on an active advance reverts `BadStatus`. After a successful write-off, a second call reverts `BadStatus` | `test_earlyMarkLateThenWriteOff` |

`invariant_solvencyAndLockgateHasNoClaim` checks four identities after deposits, withdrawals, funding, repayment, reserve moves, skim, mark-late, and write-off. The token balance equals idle cash plus reserve cash. `totalAssets` equals idle cash plus `outstandingPrincipal`. On each advance, owed equals the fee still open plus the principal still open, and a remaining fee means the principal has not been reduced yet. `sharesOf(owner)` equals `totalShares`. Lockgate's share balance and token balance stay 0, and Lockgate is not the owner.
