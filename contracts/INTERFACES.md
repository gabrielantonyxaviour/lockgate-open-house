# Core interfaces

## SUMMARY

Stage-1 surfaces live in `contracts/src/interfaces`. Decode logs and reverts with the names in the next section. The engine and the harness already match those names. Other sessions request changes in `contracts/INTERFACE-REQUESTS.md`. G6 decides. Door 2 (`OpenCreditVault`, `LockgateExitPool`) is removed from the deploy plan: not deployed, superseded. The sources stay in `src/core` for their unit tests only.

## Names the engine and the harness match

Use this section when you decode a log or a revert from the stage-1 contracts. Checked on 2026-10-02 against `engine/src/sweep/sweep.ts`, `engine/test/interface.test.ts`, `engine/test/anvil/flows.test.ts`, and `harness/src/actions`. `test/core/InterfaceNames.t.sol` locks the call selectors, the harness revert names, the tuple field order, the quote strings `gated` and `paused`, and every event topic in the tables below.

The engine encodes `repay(uint256)` and `markLate(uint256)` from a two-function ABI and does not decode custom errors. Its Anvil flow reads return values by index. The harness loads the compiled ABI of the contract it calls and matches viem's `errorName` as a substring.

### Call selectors

These are the stage-1 calls the engine and the harness encode. The test checks each selector against the signature string. The two hex values are the pins in `engine/test/interface.test.ts`.

| Call | Canonical signature | Who reads it |
| --- | --- | --- |
| `repay` | `repay(uint256)`, selector `0x371fd8e6` | Engine sweep, on the own-book line |
| `markLate` | `markLate(uint256)`, selector `0x184f24db` | Engine sweep, on the own-book line |
| `registerSource` | `registerSource(address,uint256,uint16)` | Harness and engine deploy |
| `setRegistrar` | `setRegistrar(address,bool)` | Engine `deploy.ts`, harness deploy |
| `quote` | `quote(address,uint256)` | Both, on the credit line |
| `feeBps` | `feeBps(uint256,uint256,bool,uint16,uint16)` | Engine Anvil flow, on `PricingEngine` |
| `createPlatform` | `createPlatform(uint8,string,uint64,uint256,address,uint256,uint16)` | Both. `onlyOwner` (Lockgate). Arguments are kind, name, interval, share NAV, issuer, limit, reserve bps. A zero issuer reverts `ZeroAddress` |
| `exitNow` | `exitNow(uint256,uint256)` | Both. Shares, then `minUsdgOut` |
| `processWindow` | `processWindow()` | Both |
| `sellToLockgate` | `sellToLockgate(uint256,uint256)` | Removed with door 2 (not deployed). Shares, then `minUsdgOut` |
| `settle` | `settle(uint256)` | Removed with door 2 (not deployed) |

`createPlatform` and `createDemoFund(string,address)` are `onlyOwner`: a non-owner call reverts `OwnableUnauthorizedAccount`. Only Lockgate can register a platform, so every limit and reserve bps is Lockgate-set. `createPlatform` kind `0` reverts `BadKind()`. Kind `1` is weekly, `2` is epoch, `3` is quarterly. Engine kind `4` (`fifo-open`) has no contract. `quoteId` still accepts that `uint8`.

### Quote strings and draw errors

The harness compares the credit-line quote `reason` to the exact strings `gated` and `paused` (`harness/src/actions/weekly.ts`). A paused `draw` reverts OpenZeppelin `EnforcedPause()` before that list. `Gated()` is the draw error for a gated source.

`quote(address,uint256)` returns `(uint256 fee, uint16 feeBps, bool available, string reason)`. The engine treats index 2 as `available`. `feeBps` returns `(uint16 bps, bool available, string reason)`. The engine treats index 0 as bps and index 1 as available. At the default curve, `feeBps(600, 0, false, 0, 0)` is 99 bps and available. The same wait on `100e6` quotes fee `990_000`.

Exit-pool `quote(uint256)` returns `(uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string reason)`. The harness fallback reads `available` at index 3 and `reason` at index 4. A gated pool returns reason `gated` and reverts `Gated()` from `sellToLockgate`.

The full quote-code table is in [Credit line](#credit-line). These four names sit beside each other and mean different checks:

| Situation | Name |
| --- | --- |
| Model fee above `maxFeeBps` | Quote reason `fee above max`. Draw error `FeeAboveMax()` |
| Priced fee above the caller's `maxFee` | `FeeTooHigh(uint256 fee, uint256 maxFee)` |
| Credit line, reserve balance short | `ReserveShort()` |
| `PlatformReserve.withdraw` below `requiredOf` | `ShortReserve(uint256 have, uint256 required_)` |
| `PlatformReserve.withdraw` above the posted balance | `OverBalance(uint256 amount, uint256 balance)` |

### Revert names the harness matches

The harness checks that the revert text contains these names. `expectRevert` is a substring match on the called contract's ABI.

| `errorName` | Declared on | When |
| --- | --- | --- |
| `WindowClosed` | `PlatformStore` | `processWindow` before `nextWindow` |
| `TooEarly` | `CreditLineAdmin` | `markLate` while `block.timestamp < dueAt + graceOf(id)` |
| `Gated` | `LockgateExitPool` | `sellToLockgate` while the pool is gated |
| `NotReady` | `LockgateExitPool` | `settle` before `readyAt` |
| `FaucetCap` | `MockUSDG` | `faucet` above `10_000e6` |
| `OwnableUnauthorizedAccount` | OpenZeppelin `Ownable` | `withdrawCapital` from a non-owner |

`markLate` stores grace on the advance. The harness action warps to `dueAt + grace() + 1` unless `warp` is `"false"`. `grace()` is the value the next draw stores. After `setGrace`, that warp and `graceOf(id)` can differ, and an early call still reverts `TooEarly()`.

### One selector, several contracts

These signatures are identical, so the selector matches on every contract that declares them. Decode with the ABI of the address you called.

| Signature | Contracts |
| --- | --- |
| `Gated()` | `CreditLineAdmin`, `PlatformStore`, `LockgateExitPool` |
| `NotReady()` | `OpenCreditVault`, `LockgateExitPool` |
| `AlreadySettled()` | `CreditLineAdmin`, `LockgateExitPool` |
| `NotAvailable(string)` | `PlatformStore`, `LockgateExitPool` |
| `Deposited(address,uint256,uint256)` | `OpenCreditVault` and `PartnerVault` |

`ZeroAddress()`, `ZeroAmount()`, `BadParam()`, `BadStatus()`, `Slippage()`, and `NotPlatform()` are also declared on more than one core contract. Same rule.

### Tuple order

The harness prefers ABI field names and falls back to these indexes.

`Advance`: 0 `source`, 1 `to`, 2 `principal`, 3 `fee`, 4 `drawnAt`, 5 `dueAt`, 6 `status`. `Active` is 0, `Repaid` is 1, `Late` is 2.

`Request`: 0 `owner`, 1 `shares`, 2 `navValue`, 3 `requestedAt`, 4 `status`, 5 `advanceId`. `Queued` is 0, `Advanced` is 1, `Paid` is 2, `Cancelled` is 3. The harness treats status 2 as paid and status 0 as still queued.

`Position`: 0 `seller`, 1 `shares`, 2 `navValue`, 3 `fee`, 4 `withdrawalId`, 5 `advanceId`, 6 `readyAt`, 7 `settled`.

### Event topics

Topic0 is `keccak256` of the canonical signature. An enum is `uint8` in that string. `indexed` does not change the string. A struct expands to its member tuple.

Credit line, declared on `ILockgateCreditLine`:

| Event | Canonical signature |
| --- | --- |
| `SourceRegistered` | `SourceRegistered(address,uint256,uint16)` |
| `SourceUpdated` | `SourceUpdated(address,uint256,uint16,uint16)` |
| `SourceDeregistered` | `SourceDeregistered(address)` |
| `RegistrarSet` | `RegistrarSet(address,bool)` |
| `CapitalDeposited` | `CapitalDeposited(address,uint256)` |
| `CapitalWithdrawn` | `CapitalWithdrawn(address,uint256)` |
| `AdvanceDrawn` | `AdvanceDrawn(uint256,address,address,uint256,uint256,uint64)` |
| `AdvanceRepaid` | `AdvanceRepaid(uint256,address,uint256,uint8)` |
| `AdvanceMarkedLate` | `AdvanceMarkedLate(uint256,address,uint256,uint256)` |
| `GraceSet` | `GraceSet(uint64)` |
| `CapsSet` | `CapsSet(uint16,uint16)` |
| `ReserveFloorSet` | `ReserveFloorSet(address,uint16)` |
| `ReservePosted` | `ReservePosted(address,address,uint256)` |

The first `registerSource` for a source emits `SourceRegistered` and `SourceUpdated`. That includes the owner's registration after `deregisterSource`. An owner `registerSource` on a source that is still registered emits `SourceUpdated` only. `setSourceTerms` emits `SourceUpdated`. `postReserve` emits `ReservePosted` for the caller, and the reserve emits `Posted` with this line as `from`. `ReserveFloorSet` fires only when the stored floor changes.

`ReservePosted(address,address,uint256)` is also the signature `PartnerVault` emits. `test/partner/Events.t.sol` keeps them apart by emitter. Filter logs by contract address.

Queue platforms inherit `PlatformStore`:

| Event | Canonical signature |
| --- | --- |
| `Configured` | `Configured(address,uint256,uint64)` |
| `NavUpdated` | `NavUpdated(uint256)` |
| `GateSet` | `GateSet(bool)` |
| `CashDeposited` | `CashDeposited(address,uint256)` |
| `SharesDeposited` | `SharesDeposited(address,uint256,uint256)` |
| `RedeemRequested` | `RedeemRequested(uint256,address,uint256,uint256)` |
| `ExitAdvanced` | `ExitAdvanced(uint256,uint256,uint256,uint256)` |
| `RequestCancelled` | `RequestCancelled(uint256)` |
| `RequestPaid` | `RequestPaid(uint256,address,uint256)` |
| `RequestPartPaid` | `RequestPartPaid(uint256,uint256,uint256)` |
| `WindowProcessed` | `WindowProcessed(uint256,uint64,bool)` |
| `AdvanceClosed` | `AdvanceClosed(uint256,uint256)` |

Door 2 (removed, not deployed), reserve, factory, pricing, shares, and the mock token:

| Event | Canonical signature |
| --- | --- |
| `GatedSet` | `GatedSet(bool)` on `LockgateExitPool` |
| `Sold` | `Sold(uint256,address,uint256,uint256,uint256,uint256)` |
| `Settled` | `Settled(uint256,uint256,uint256)` |
| `Deposited` | `Deposited(address,uint256,uint256)` on `OpenCreditVault` |
| `YieldAccrued` | `YieldAccrued(uint256)` |
| `WithdrawalRequested` | `WithdrawalRequested(uint256,address,uint256,uint256,uint64)` |
| `Claimed` | `Claimed(uint256,address,uint256)` |
| `CooldownSet` | `CooldownSet(uint64)` |
| `Posted` | `Posted(address,address,uint256)` on `PlatformReserve` |
| `Withdrawn` | `Withdrawn(address,address,uint256)` on `PlatformReserve` |
| `Slashed` | `Slashed(address,address,uint256)` |
| `AdminSet` | `AdminSet(address,address)` |
| `SlasherSet` | `SlasherSet(address,bool)` |
| `CreditLineSet` | `CreditLineSet(address)` |
| `SlashersLockedSet` | `SlashersLockedSet()` |
| `PlatformCreated` | `PlatformCreated(address,address,uint8,string)` |
| `DemoWindowSet` | `DemoWindowSet(uint64)` |
| `ParamsUpdated` | `ParamsUpdated((uint16,uint16,uint16,uint16,uint16,uint16,uint32,uint16,uint64,uint64,uint16,uint16,uint16,uint64,uint64))` |
| `AllowlistSet` | `AllowlistSet(address,bool)` on `PlatformShare` |
| `MinterSet` | `MinterSet(address,bool)` |
| `Faucet` | `Faucet(address,uint256)` |
| `Minted` | `Minted(address,uint256)` |

The partner vault uses its own names for a funded advance. Decode those logs with the vault ABI: `AdvanceFunded(uint256,address,address,uint256,uint256,bytes32)`, `AdvanceRepaid(uint256,address,uint256)`, `AdvanceLate(uint256,uint256,uint256)`. The credit-line `AdvanceRepaid` topic has a fourth `uint8` status. `CreditFacility` emits `Drawn(address,uint256)` and `Repaid(address,uint256)`.

`OpenCreditVault.Deposited` and `PartnerVault.Deposited` share the topic `Deposited(address,uint256,uint256)`. Filter by the contract address.

Ownable contracts also emit `OwnershipTransferred(address,address)`. The credit line emits `Paused(address)` and `Unpaused(address)`. `MockUSDG`, `PlatformShare`, and `OpenCreditVault` emit ERC-20 `Transfer` and `Approval`.

### Custom errors by contract

`CreditLineAdmin` (on `LockgateCreditLine`): `NotRegistrar()`, `Unregistered()`, `ZeroAddress()`, `ZeroAmount()`, `Gated()`, `WindowDue()`, `BadNavTime()`, `OverLimit()`, `ConcentrationCap()`, `UtilizationCap()`, `ReserveShort()`, `CapitalShort()`, `FeeConsumesValue()`, `StaleNav()`, `Tenor()`, `FeeAboveMax()`, `FeeTooHigh(uint256,uint256)`, `UnknownAdvance()`, `BadStatus()`, `TooEarly()`, `AlreadySettled()`, `AlreadyRegistered()`, `BadParam()`, `StillExposed()`, `RenounceDisabled()`. The same ABI includes OpenZeppelin `EnforcedPause()`, `ExpectedPause()`, `OwnableUnauthorizedAccount(address)`, `OwnableInvalidOwner(address)`, `ReentrancyGuardReentrantCall()`, and `SafeERC20FailedOperation(address)`.

`PlatformStore`: `NotIssuer()`, `NotOwner()`, `Gated()`, `ZeroAmount()`, `BadStatus()`, `WindowClosed()`, `WindowGated()`, `Slippage()`, `NotAvailable(string)`, `BadConfig()`, `QueueFull()`.

`LockgateExitPool`: `ZeroAddress()`, `ZeroAmount()`, `Gated()`, `NotAvailable(string)`, `Slippage()`, `UnknownPosition()`, `NotReady()`, `AlreadySettled()`.

`OpenCreditVault`: `ZeroAddress()`, `ZeroAmount()`, `BadParam()`, `UnknownWithdrawal()`, `NotReady()`, `AlreadyClaimed()`, `Insolvent()`.

`PlatformReserve`: `ZeroAddress()`, `ZeroAmount()`, `AlreadySet()`, `NotPlatform()`, `NotAdmin()`, `NotSlasher()`, `SlashersLocked()`, `ShortReserve(uint256,uint256)`, `OverBalance(uint256,uint256)`.

`FundFactory`: `DemoRequiresMock()`, `BadKind()`, `BadParam()`, `ZeroAddress()`.

`PricingEngine`: `BadParams(string)`.

`PlatformShare`: `NotPlatform()`, `NotAllowlisted()`, `Blocked()`, `ZeroAddress()`. `Blocked` is the issuer ban on the next `deposit`. A transfer of a banned holder reverts `NotAllowlisted`. `requestRedeem` of shares already held still queues.

`UsdgAdapter`: `ZeroAddress()`, `BadDecimals(uint8)`, `CanonicalCannotBeMock()`.

`UsdgTransfers`: `FeeOnTransfer(uint256,uint256)`.

`MockUSDG`: `FaucetCap(uint256)`, `NotMinter()`, `ZeroAddress()`.

`IPartnerVault.payoutTo(address)` is declared on `src/partner/interfaces/IPartnerVault.sol` at selector `0x63aec9af`. `PartnerVaultRead` implements it. The engine reads the partner vault. Core interfaces leave that function on the partner file. The earlier ask, and the note that closes it, are in `INTERFACE-REQUESTS.md`.

G7 and G8 were re-checked against this tree on 2026-10-02. `CreditLineBook` calls `eligibleOutstanding()` (`0x94f98c87`) and `lateOutstanding()` (`0xb7c7cc20`). `test/partner/CoreLink.t.sol` equates `repay` (`0x371fd8e6`), `markLate` (`0x184f24db`), and `graceOf` (`0x69043c09`) with this line. `engine/test/interface.test.ts` pins `submitProposal` `0xe7c1fee8` and those same `repay` and `markLate` selectors. `AdvanceProposal` field order matches `engine/src/proposal/typed.ts`. `engine/test/anvil/flows.test.ts` calls `createPlatform`, `quote`, `feeBps`, `postReserve`, `exitNow`, and `getAdvance` with the tuples in this file. `deploy.ts` constructor order matches `FundFactory`, `PlatformConfig`, `PartnerVault.initialize`, and `FacilityStore.Init`. The engine loads call ABIs from the compiled artifacts and does not decode `ReservePosted` or `Configured`. Still open from that re-check: ceil `feeFromBps` against the engine's half-up token fee, and engine kind `4` (`fifo-open`). The caller-surface section below is the later pass.

## Caller surface

Checked on 2026-10-02 against `engine/src/sweep/sweep.ts`, `engine/src/proposal/vaultread.ts`, `harness/src/actions/stage1.ts`, `harness/src/actions/weekly.ts`, `e2e/src/stage3.ts`, and `contracts/src/partner/PartnerVaultRead.sol`. The four views were already public getters. They are now on the interfaces. Selectors are unchanged. `test/core/CallerViews.t.sol` calls them through the interface types. This pass adds no event.

| View | Selector | Who reads it |
| --- | --- | --- |
| `totalExposure()` | `0x79f883da` | `e2e/src/stage3.ts` `bookMatches`. Equals `eligibleOutstanding + lateOutstanding`. |
| `accountedAssets()` | `0xd4347f25` | `capital() + outstanding`. Matches `accountedEquity` until a direct token donation. |
| `accountedEquity()` | `0x744274cc` | `deposited + earnedFees - withdrawn`. `test/partner/Lifecycle.t.sol` reads this minus `outstanding` as idle equity. |
| `requestCount()` | `0x5badbe4c` | Harness stage-1 and weekly actions, after `requestRedeem`. Highest request id. Cancelled and paid ids stay in the count. |

`PartnerVaultRead._gateReason` staticcalls `gated()` (`0x907cf318`) and `navUpdatedAt()` (`0xfc11cdd6`) and decodes each return as one `uint256` word. Both functions are already on `ICreditSource`. Weekly, epoch, and quarterly platforms inherit them. A word other than 0 or 1 is gated. A timestamp above `uint64` max is stale. A failed or short return is closed. `CallerViewsTest` decodes the same words. `OpenCreditVault` exposes `navUpdatedAt()`. It has no `gated()`.

The engine sweep encodes `repay(uint256)` `0x371fd8e6` and `markLate(uint256)` `0x184f24db`. `vaultread.ts` reads partner-vault views (`paused`, `idle`, `totalAssets`, `mandate`, `platformConfig`, `payoutTo`, `nonceUsed`, `proposalHashOf`, `preview`). The engine does not call `previewSettlement`. It does not decode logs.

These public getters stay off the published interfaces. The call sites above do not read them: `registered(address)`, `token()`, `pricing()`, `reserveVault()`, `maxUtilizationBps`, `maxConcentrationBps`, `deposited`, `withdrawn`, `registrars`, `openCount`, `firstOpen`, `nextOpen`, `MAX_OPEN`, `isSlasher`, `tokenBalance`, `IOpenCreditVault.getWithdrawal`, and `withdrawals(uint256)`. `kind()` stays on `IQueueAdapter`.

## Compile

From `contracts/`:

```bash
FOUNDRY_PROFILE=core forge test
```

Foundry 1.7.1 has no `--profile` flag. Set `FOUNDRY_PROFILE`. `via_ir` is on because the inlined quote overflows the legacy stack. Default `src` stays `src`. Vendored libs: forge-std 1.11.0, OpenZeppelin 5.3.0 (`package.json` in `contracts/lib`).

## USDG

`UsdgAdapter` binds one 6-decimal token. It does not custody and it is not the spender. Callers approve `LockgateCreditLine` or `PlatformReserve`.

`ARBITRUM_SEPOLIA_USDG` is `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`. On 2026-10-02 the Arbitrum Sepolia token page names that proxy Global Dollar (USDG), 6 decimals, ERC-1967: <https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892>. `isMock = true` on that address reverts `CanonicalCannotBeMock`. Any other 6-decimal token is allowed. `MockUSDG` is named `test USDG`, symbol `USDG`, 6 decimals. `faucet` caps each call at `10_000e6`. The owner is a minter.

`UsdgTransfers.pull` and `push` revert `FeeOnTransfer(expected, received)` unless the recipient balance rises by `amount`. A recipient that forwards the tokens inside that transfer cannot be paid.

Sepolia path: deploy a second adapter on the canonical token with `isMock = false`. `FundFactory.createDemoFund` reverts `DemoRequiresMock` on that adapter.

## Credit line

`ILockgateCreditLine` is Lockgate's own book. Partner vaults are G7.

`draw(navValue, to, maxFee)` pays `to` the principal `navValue - fee` and records an obligation of `navValue`. Fee is ceil (`PricingMath.feeFromBps`). `fee >= navValue` reverts `FeeConsumesValue`. `priced > maxFee` reverts `FeeTooHigh`. The fee is not earned at draw. It is earned only when recovery passes the principal. `outstanding` is unpaid principal. `exposure(source)` is unpaid obligation (principal + fee − recovered).

`eligibleOutstanding` is that unpaid obligation on `Active` advances. `lateOutstanding` is the same on `Late` advances. A late advance the reserve covered in full adds 0. Repaid advances add 0. Their sum equals `totalExposure()`. That view is on `ILockgateCreditLine` at selector `0x79f883da`. `CreditLineBook` (G7) calls the two outstanding selectors. Point it at this line.

`repay(id)` pulls the full remainder from the source. Anyone may call it, including while paused. `Active` becomes `Repaid`. `Late` stays `Late`.

`markLate(id)` is anyone, once `block.timestamp >= dueAt + graceOf(id)`. `graceOf(id)` is stored at draw. `grace()` is what the next draw stores. The default is 1 day. `setGrace` does not shorten an open advance. It slashes `min(reserve, remaining)` into the credit line, then sets `Late` even when the slash covers the advance. One second early reverts `TooEarly`. A registrar cannot call `registerSource` again on a source that is already registered. The owner still can. Utilization and concentration round up.

`quote` returns `(0, 0, false, reason)` on every refusal, including `"fee above max"`. `PricingEngine.feeBps` is different: a fee above the max returns `(maxFeeBps, false, "fee above max")` and does not clamp. `feeCode` returns `(maxFeeBps, 15)` in that case.

Quote and draw checks, in order: unregistered, paused, zero, gated, window due (`nextWindow <= now`), future NAV, over limit, concentration, pricing, fee consumes value, capital, utilization, reserve. A paused `draw` hits OpenZeppelin `EnforcedPause` before that list. `quote` still returns `"paused"`.

| code | reason | draw error |
| --- | --- | --- |
| 1 | unregistered | `Unregistered` |
| 2 | paused | `EnforcedPause` on draw |
| 3 | zero | `ZeroAmount` |
| 4 | gated | `Gated` |
| 5 | window due | `WindowDue` |
| 6 | bad nav time | `BadNavTime` |
| 7 | over limit | `OverLimit` |
| 8 | concentration | `ConcentrationCap` |
| 9 | utilization | `UtilizationCap` |
| 10 | reserve | `ReserveShort` |
| 11 | capital | `CapitalShort` |
| 12 | fee consumes value | `FeeConsumesValue` |
| 13 | stale nav | `StaleNav` |
| 14 | tenor | `Tenor` |
| 15 | fee above max | `FeeAboveMax` |
| other | pricing | `BadParam` |

`exitEarly` can also return `"not queued"` and `"reserve"` through the platform quote.

Utilization used for pricing is the pre-draw book: `outstanding * 10000 / (capital + outstanding)`, floored. The hard cap ceils `(outstanding + principal) * 10000 / (capital + outstanding)` on that same denominator, measured before the token move. Outstanding 5000 and capital 5001 is view 4999. A cap of 5000 reverts `UtilizationCap` on the next principal of 1. A cap of 5001 draws it, and the view is 5000. Capital 0 with outstanding 5000 reports 10000, and the quote is `"capital"` because that check comes first. `capital()` is the token balance. Concentration is the source's post-draw share of exposure. `maxConcentrationBps` defaults to 10000 because the first draw is always 100% of the book. A later `setCaps` binds later draws only. Every deploy (harness `wire`, `sepolia.ts`) calls `setCaps(8000, 10000)`, constants `LINE_CAPS` in `harness/src/params.ts`: utilization 80%, concentration stays 100%. Concentration is one source's share of total exposure, not of capital, so with a single platform drawing any cap below 100% blocks the first draw. The per-source limit and reserve bound one platform instead. Test: `harness/test/caps.test.ts`.

Required reserve is `ceil(exposure * activeReserveBps / 10000)`. `activeReserveBps` is the higher of the live `reserveBpsOf` and `reserveFloorBps`. The floor rises with a higher rate and falls back to the live rate only when that source's exposure hits 0. `setSourceTerms` to 0 does not let the platform withdraw first-loss cash while an advance is open.

Identity, with no donations: `capital() + outstanding == deposited + earnedFees - withdrawn`. Those are `accountedAssets()` (`0xd4347f25`) and `accountedEquity()` (`0x744274cc`) on `ILockgateCreditLine`. `withdrawCapital` cannot take more than `equity - outstanding`. After a draw, `outstanding` is unpaid principal, so the owner can withdraw the line's remaining token balance while `earnedFees` is still 0. `test_ownerWithdrawsIdleWhileTheFeeIsUnrealized` A direct token donation is not withdrawable equity. There is no write-off.

`registerSource` is the owner or a registrar. `setRegistrar`, `setSourceTerms`, `deregisterSource`, `depositCapital`, `withdrawCapital`, `pause`, `unpause`, `setGrace`, `setCaps` are owner. Deregister reverts `StillExposed` while exposure is non-zero. `renounceOwnership` reverts `RenounceDisabled`, so repaid USDG keeps an owner who can call `withdrawCapital`. `postReserve` pulls from the caller into the line, then `reserve.post`. It does not emit `CapitalDeposited`.

## Pricing

Day count is ACT/365, `yearSeconds = 31_536_000`, the same constant as `engine/src/money.ts` (`SECONDS_PER_YEAR`). APR is additive: utilization curve (half-up lerp) + risk + NAV-age after the warn + concentration saturated at the cap. Priced seconds are `secondsToWindow * timeScale`. Fee bps are half-up: `(apr * seconds * timeScale + year/2) / year`.

Constructor defaults: base 1200, kink 6667, APR at kink 1200, APR at full 1800, min 25, max 1500, timeScale 4320, max risk premium 600, NAV warn 1 day, max NAV age 7 days, NAV-age premium 300, concentration cap 10000, concentration premium 0, max tenor 366 days. A 10-minute wait at those defaults is 99 bps: `(1200 * 600 * 4320 + 31536000/2) / 31536000 = 99`. That is the stage-1 headline of about 1% for a demo window (`lockgate/SPEC.md`). It is not a 360-day 100 bps quote.

`raw < minFeeBps` floors to the min and stays available. `navAge == maxNavAge` is still fresh. One second past it is `"stale nav"` and bps 0. `platformRiskBps` 0 adds no APR. 10000 adds the full `maxRiskPremiumAprBps`. `setParams` reverts `BadParams` for a decreasing curve, kink outside 1..9999, `min > max` or `max > 10000`, timeScale outside 1..1e6, `maxNavAge == 0`, warn above max age, concentration cap outside 1..10000, year outside 360..366 days, or `maxTenor == 0`.

`validate` requires the model to be available and `model <= proposedBps <= maxFeeBps`. Extra reasons: `"below model"`, `"above max"`.

On-chain token fee is ceil. `feeFromBps(10001, 1) = 2`. Since 2026-10-02 the engine token fee also rounds up (`engine/src/quote.ts`), and the engine refuses (block `max-fee`) when the raw fee is above `maxFeeBps` instead of clamping. Its curve defaults equal the constructor defaults above, and `sim/src/pricing.ts` is an exact BigInt port of `PricingMath.quoteCode`. See `INTERFACE-REQUESTS.md`.

`timeScale` and the window length are one choice. Demo funds use a 600-second window with timeScale 4320. A 90-day wait at timeScale 4320 is above the 1500 bps max and is refused. The same wait at timeScale 1 prices at 296 bps on the 1200 base.

`feeCode` exists so the draw path does not return a string. Codes: 0 available, 4 gated, 13 stale nav, 14 tenor, 15 fee above max.

## Reserve

`PlatformReserve` holds first-loss USDG apart from lending cash. `post` is anyone. `withdraw` is the platform or its admin. An amount above the posted balance reverts `OverBalance`. A smaller amount cannot pass below `requiredOf` (0 when the credit line is unset or exposure is 0). The reserve owner cannot withdraw platform funds. `setAdmin` is `msg.sender == platform` only. `slash` is a named slasher, sends to `msg.sender`, and may be partial. A zero slash still emits `Slashed` and returns 0. `setCreditLine` is once. `lockSlasherSet` is one-way. `setSlasher(address(0))` reverts `ZeroAddress` after the owner check.

## Queues

`QueueKind`: None 0, WeeklyCycle 1, Epoch 2, QuarterlyGated 3. Those numbers match the engine `kindCode`. Kind 4 (fifo-open) is not a contract. `createPlatform(None)` reverts `BadKind`.

`ICreditSource` is what the credit line reads: `nav` (6-decimal USDG per 1e18 shares), `navUpdatedAt` (`0xfc11cdd6`), `gated` (`0x907cf318`), `nextWindow`. Partner `PartnerVaultRead._gateReason` staticcalls the gate and the timestamp and decodes each as a `uint256` word.

`requestCount()` on `IIssuerFund` is selector `0x5badbe4c`. It is the highest request id. Cancelled and paid ids stay in the count. The harness reads it after `requestRedeem`.

Shares are 18 decimals. A redemption locks NAV at request time. `quoteExit` uses current NAV. Deposits are allowed while gated. User share transfers require both sides allowlisted. The platform itself may move shares. Mint and burn are platform-only.

`processWindow` repays Lockgate first, oldest advance first, each whole obligation. If the next advance does not fit in cash, it stops. It does not pay the investor queue and it does not roll the window. If Lockgate is clear, it pays the queue, then rolls one interval even when the queue is short. `WindowProcessed` carries the new cycle id when `rolled` is true, and the current id when it is false. `nextWindow` is unchanged when the roll fails, so a later `processWindow` in the same timestamp can finish once cash arrives.

Weekly pays whole queued requests in id order and stops at the first that does not fit. It does not skip. A gate blocks `requestRedeem` and `exitEarly`. It does not block weekly `processWindow`.

Epoch pays pro-rata of queued NAV against the cash snapshot taken before the loop. If cash covers the queue it uses FIFO. A slice that burns zero shares is not paid, and the preview omits it. Dust stays queued. Two claims of nav 3 against cash 5 preview as payable 4 and shortfall 2. Each holder is paid 2. Cash left is 1. Both requests stay queued at nav 1. The next epoch pays 0 of that unit. Two 1-share claims at nav 2 against cash 2 preview as payable 0 and shortfall 4.

Quarterly is the same FIFO, and a closed gate reverts `processWindow` with `WindowGated`. Lockgate then depends on `markLate` and the reserve. Ungating lets the window clear.

`exitEarly` checks the quote before slippage. No reserve therefore reverts `NotAvailable("reserve")`, not `Slippage`. `minUsdgOut` above the quoted payout reverts `Slippage`.

## Door 2 (removed: not deployed, superseded)

The contracts below are no longer in the deploy plan. They move investor positions, which contradicts "investor positions never move". They are kept for their unit tests only and carry `@custom:status NOT DEPLOYED, SUPERSEDED`.

`OpenCreditVault` is an 18-decimal ERC-20 (`Open credit token`, `oUSDG`). NAV is 6-decimal USDG per 1e18 shares and starts at `1_000_000`. `deposit` pulls USDG and mints `usdg * 1e18 / nav`. `requestWithdraw` burns the caller's shares, moves `shares * nav / 1e18` from `assets` into `reserved`, and starts a cooldown. It reverts `Insolvent` when that nav exceeds `assets`. The default cooldown is 5 minutes. `setCooldown(0)` reverts `BadParam`. `claim` pays the withdrawal's owner after `readyAt`. Anyone may call it.

`accrue` is permissionless. On MockUSDG, deploy with `mintYield = true` and `setMinter(vault, true)`. Yield is the floor `assets * 900 * dt / (10000 * 31536000)` (9% APR, ACT/365). One year on 100e6 assets mints 9e6 and sets NAV to `1_090_000`. `mintYield = false` does not mint. That is the real-USDG path. `deposit`, `requestWithdraw`, `claim`, and `accrue` are `nonReentrant`. Token balance equals `assets + reserved` when every unit was minted or deposited through the vault.

`LockgateExitPool` is the credit-line source. Register it with `reserveBps` 0. `nextWindow()` is `block.timestamp + cooldown`, so `dueAt` on a draw is the end of that sell's cooldown. `gated` stops `quote` and `sellToLockgate`. It does not stop `settle`.

`sellToLockgate` accrues first. The charged fee uses that fresh NAV. A view `quote` from before `accrue` can still be stale. `draw` is called with `maxFee` equal to the quoted fee, not the payout. The pool then withdraws the shares it just took. In that same transaction `owed` equals `navValue`, because no time passes after the accrue.

A 5-minute cooldown on the default curve is 49 bps: `(1200 * 300 * 4320 + 31536000/2) / 31536000 = 49`. On 100e6 the fee is `490_000` and the seller receives `99_510_000`. `PricingMath` is unchanged. The 600-second quote stays 99 bps.

`settle` is anyone after `readyAt`. It claims into the pool, then repays the advance. A `Late` advance stays `Late`. After a full repay the pool's token balance is 0.

## EIP-712

`AdvanceProposalLib` matches `engine/src/proposal/typed.ts`. Domain name `LockgateAdvance`, version `1`, verifying contract is the vault. The vault is not a struct field.

Type string:

```text
AdvanceProposal(address platform,address recipient,uint256 requestId,uint256 navValue,uint256 fee,uint256 payout,uint16 feeBps,uint64 dueAt,uint64 expiresAt,uint256 nonce,bytes32 quoteId)
```

`quoteId` is `keccak256(abi.encode(platform, navValue, fee, dueAt, riskBps, utilizationBps, navUpdatedAt, kind))`. The stage-1 credit line does not verify this signature. Partner vaults are G7.

## Factory

`FundFactory` clones three locked implementations. It does not `new` a platform, so their bytecode is not inside the factory. EIP-170 stops deployed bytecode above 24576 bytes (<https://eips.ethereum.org/EIPS/eip-170>). EIP-3860 stops init code above 49152 bytes (<https://eips.ethereum.org/EIPS/eip-3860>). G10 measured the old embedded factory, on 2026-10-02, at 49873 init bytes and 49258 deployed bytes. That contract cannot be created on a normal EVM.

Constructor arguments, in order: `owner`, `adapter`, `creditLine`, `reserve`, `weeklyImpl`, `epochImpl`, `quarterImpl`. Deploy `WeeklyCyclePlatform`, `EpochQueuePlatform`, and `QuarterlyWindowPlatform` first, each with a zero-token `PlatformConfig`. That locks the implementation (`initialize` reverts). Each clone starts empty. The factory calls `initialize` before it returns. Direct `new WeeklyCyclePlatform(cfg)` still initializes when `cfg.token` is set. `engine/test/anvil/deploy.ts` deploys the three locked implementations, then passes all seven constructor arguments. G6 did not edit `engine/`.

`createDemoFund(name, issuer)` is `onlyOwner` and works only if the adapter `isMock`. Seeds: NAV `1_023_400`, share value `10_000e6`, cash `2_000e6`, limit `25_000e6`, reserve 750 bps (`1_875e6`), window `demoWindow` (default 600). The factory must be a credit-line registrar and a `MockUSDG` minter. `createPlatform` registers and does not mint shares or post reserve. The owner passes the limit and reserve bps. `createPlatform(None)` reverts `BadKind`.

## Deploy order for G10

1. `MockUSDG`, then `UsdgAdapter(mock, true)`. Sepolia uses `UsdgAdapter(canonical, false)` instead, and skips the demo mint.
2. `PricingEngine`, `PlatformReserve`, `LockgateCreditLine`.
3. `reserve.setCreditLine(line)`, `reserve.setSlasher(line, true)`.
4. Three locked implementations (zero-token config), then `FundFactory` with those addresses. `line.setRegistrar(factory, true)`. `mock.setMinter(factory, true)` on the mock path.
5. Owner `depositCapital`, then `setCaps(8000, 10000)`. `createDemoFund` on the mock path.
6. Door 2 is removed from the plan.
7. `reserve.lockSlasherSet()` when the slasher set should freeze.

G10 owns the deploy scripts. This tree does not deploy.
