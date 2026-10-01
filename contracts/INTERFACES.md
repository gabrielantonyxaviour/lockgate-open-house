# Core interfaces

## SUMMARY

Stage-1 surfaces live in `contracts/src/interfaces`. Other sessions build against this file. Changes are requested in `contracts/INTERFACE-REQUESTS.md`. G6 decides. Door 2 (`OpenCreditVault`, `LockgateExitPool`) is in `src/core`.

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

`eligibleOutstanding` is that unpaid obligation on `Active` advances. `lateOutstanding` is the same on `Late` advances. A late advance the reserve covered in full adds 0. Repaid advances add 0. Their sum equals `totalExposure`. `CreditLineBook` (G7) calls these two selectors. Do not point it at a partner vault.

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

Utilization used for pricing is the pre-draw book: `outstanding * 10000 / (capital + outstanding)`. The hard cap uses the post-draw principal over the same denominator `(capital + outstanding)` measured before the token move. `capital()` is the token balance. Concentration is the source's post-draw share of exposure. `maxConcentrationBps` defaults to 10000 because the first draw is always 100% of the book. A later `setCaps` binds later draws only.

Required reserve is `ceil(exposure * activeReserveBps / 10000)`. `activeReserveBps` is the higher of the live `reserveBpsOf` and `reserveFloorBps`. The floor rises with a higher rate and falls back to the live rate only when that source's exposure hits 0. `setSourceTerms` to 0 does not let the platform withdraw first-loss cash while an advance is open.

Identity, with no donations: `capital() + outstanding == deposited + earnedFees - withdrawn` (`accountedAssets` and `accountedEquity`). `withdrawCapital` cannot take more than `equity - outstanding`. A direct token donation is not withdrawable equity. Unrealized fee cash can be withdrawn. There is no write-off.

`registerSource` is the owner or a registrar. `setRegistrar`, `setSourceTerms`, `deregisterSource`, `depositCapital`, `withdrawCapital`, `pause`, `unpause`, `setGrace`, `setCaps` are owner. Deregister reverts `StillExposed` while exposure is non-zero. `postReserve` pulls from the caller into the line, then `reserve.post`. It does not emit `CapitalDeposited`.

## Pricing

Day count is ACT/365, `yearSeconds = 31_536_000`, the same constant as `engine/src/money.ts` (`SECONDS_PER_YEAR`). APR is additive: utilization curve (half-up lerp) + risk + NAV-age after the warn + concentration saturated at the cap. Priced seconds are `secondsToWindow * timeScale`. Fee bps are half-up: `(apr * seconds * timeScale + year/2) / year`.

Constructor defaults: base 1200, kink 6667, APR at kink 1200, APR at full 1800, min 25, max 1500, timeScale 4320, max risk premium 600, NAV warn 1 day, max NAV age 7 days, NAV-age premium 300, concentration cap 10000, concentration premium 0, max tenor 366 days. A 10-minute wait at those defaults is 99 bps: `(1200 * 600 * 4320 + 31536000/2) / 31536000 = 99`. That is the stage-1 headline of about 1% for a demo window (`lockgate/SPEC.md`). It is not a 360-day 100 bps quote.

`raw < minFeeBps` floors to the min and stays available. `navAge == maxNavAge` is still fresh. One second past it is `"stale nav"` and bps 0. `platformRiskBps` 0 adds no APR. 10000 adds the full `maxRiskPremiumAprBps`. `setParams` reverts `BadParams` for a decreasing curve, kink outside 1..9999, `min > max` or `max > 10000`, timeScale outside 1..1e6, `maxNavAge == 0`, warn above max age, concentration cap outside 1..10000, year outside 360..366 days, or `maxTenor == 0`.

`validate` requires the model to be available and `model <= proposedBps <= maxFeeBps`. Extra reasons: `"below model"`, `"above max"`.

On-chain token fee is ceil. `feeFromBps(10001, 1) = 2`. The engine token fee is half-up (`engine/src/quote.ts`, `mulDivRoundHalfUp`), which is 1 for that input. The engine also clamps the charged bps (`Math.min(max, Math.max(min, raw))` in that file). On-chain refuses instead. See `INTERFACE-REQUESTS.md`.

`timeScale` and the window length are one choice. Demo funds use a 600-second window with timeScale 4320. A 90-day wait at timeScale 4320 is above the 1500 bps max and is refused. The same wait at timeScale 1 prices at 296 bps on the 1200 base.

`feeCode` exists so the draw path does not return a string. Codes: 0 available, 4 gated, 13 stale nav, 14 tenor, 15 fee above max.

## Reserve

`PlatformReserve` holds first-loss USDG apart from lending cash. `post` is anyone. `withdraw` is the platform or its admin and cannot pass below `requiredOf` (0 when the credit line is unset or exposure is 0). The reserve owner cannot withdraw platform funds. `setAdmin` is `msg.sender == platform` only. `slash` is a named slasher, sends to `msg.sender`, and may be partial. A zero slash still emits `Slashed` and returns 0. `setCreditLine` is once. `lockSlasherSet` is one-way. `setSlasher(address(0))` reverts `ZeroAddress` after the owner check.

## Queues

`QueueKind`: None 0, WeeklyCycle 1, Epoch 2, QuarterlyGated 3. Those numbers match the engine `kindCode`. Kind 4 (fifo-open) is not a contract. `createPlatform(None)` reverts `BadKind`.

`ICreditSource` is what the credit line reads: `nav` (6-decimal USDG per 1e18 shares), `navUpdatedAt`, `gated`, `nextWindow`.

Shares are 18 decimals. A redemption locks NAV at request time. `quoteExit` uses current NAV. Deposits are allowed while gated. User share transfers require both sides allowlisted. The platform itself may move shares. Mint and burn are platform-only.

`processWindow` repays Lockgate first, oldest advance first, each whole obligation. If the next advance does not fit in cash, it stops. It does not pay the investor queue and it does not roll the window. If Lockgate is clear, it pays the queue, then rolls one interval even when the queue is short. `WindowProcessed` carries the new cycle id when `rolled` is true, and the current id when it is false. `nextWindow` is unchanged when the roll fails, so a later `processWindow` in the same timestamp can finish once cash arrives.

Weekly pays whole queued requests in id order and stops at the first that does not fit. It does not skip. A gate blocks `requestRedeem` and `exitEarly`. It does not block weekly `processWindow`.

Epoch pays pro-rata of queued NAV against the cash snapshot taken before the loop. If cash covers the queue it uses FIFO. A slice that burns zero shares is not paid. Dust stays queued.

Quarterly is the same FIFO, and a closed gate reverts `processWindow` with `WindowGated`. Lockgate then depends on `markLate` and the reserve. Ungating lets the window clear.

`exitEarly` checks the quote before slippage. No reserve therefore reverts `NotAvailable("reserve")`, not `Slippage`. `minUsdgOut` above the quoted payout reverts `Slippage`.

## Door 2

`OpenCreditVault` is an 18-decimal ERC-20 (`Open credit token`, `oUSDG`). NAV is 6-decimal USDG per 1e18 shares and starts at `1_000_000`. `deposit` pulls USDG and mints `usdg * 1e18 / nav`. `requestWithdraw` burns the caller's shares, moves `shares * nav / 1e18` from `assets` into `reserved`, and starts a cooldown. The default cooldown is 5 minutes. `setCooldown(0)` reverts `BadParam`. `claim` pays the withdrawal's owner after `readyAt`. Anyone may call it.

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

`createDemoFund` only if the adapter `isMock`. Seeds: NAV `1_023_400`, share value `10_000e6`, cash `2_000e6`, limit `25_000e6`, reserve 750 bps (`1_875e6`), window `demoWindow` (default 600). The factory must be a credit-line registrar and a `MockUSDG` minter. `createPlatform` registers and does not mint shares or post reserve. `createPlatform(None)` reverts `BadKind`.

## Deploy order for G10

1. `MockUSDG`, then `UsdgAdapter(mock, true)`. Sepolia uses `UsdgAdapter(canonical, false)` instead, and skips the demo mint.
2. `PricingEngine`, `PlatformReserve`, `LockgateCreditLine`.
3. `reserve.setCreditLine(line)`, `reserve.setSlasher(line, true)`.
4. Three locked implementations (zero-token config), then `FundFactory` with those addresses. `line.setRegistrar(factory, true)`. `mock.setMinter(factory, true)` on the mock path.
5. Owner `depositCapital`. `createDemoFund` on the mock path.
6. Door 2, mock path: `OpenCreditVault(owner, token, true)`, `mock.setMinter(vault, true)`, `LockgateExitPool(owner, vault, line)`, `registerSource(pool, limit, 0)`. Real USDG uses `mintYield = false` and skips `setMinter`.
7. `reserve.lockSlasherSet()` when the slasher set should freeze.

G10 owns the deploy scripts. This tree does not deploy.
