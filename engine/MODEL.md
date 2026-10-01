# Pricing and risk model

## SUMMARY

The engine prices an exit as a fee in basis points of face (`navValue`), then builds an unsigned EIP-712 `AdvanceProposal`. It does not move funds and does not hold a partner key. A 30-day epoch at 12% APR with the worked book below charges **109 bps** (109 USDG on 10,000 USDG). The time-only piece of that quote is **99 bps**. A busy book (utilization 6,667) charges **146 bps**. A full book charges **159 bps**. A 5-day Kasu-style week and a covered Maple-style day both hit the **25 bps** floor. Numbers below are outputs of `src/examples.ts` under `DEFAULT_PARAMS`, not market observations.

## What is priced

Lockgate advances USDG to the platform. The platform pays the investor. The investor position does not move. The vault is owed `navValue` back. The cash sent is `payout = navValue − fee`. Stage 2 is a flat technology fee on the partner relationship. This model prices the advance. It does not price that flat fee. Source for the product shape: `briefs/grok/PRODUCT.md` (agreed 1–2 Oct 2026). The older door-2 path in `lockgate/ideation/DECISIONS.md` (buy the token below NAV, reserve 0) is not this engine.

## Parameters

| Name | Value | Status |
|---|---|---|
| `baseAprBps` | 1,200 | "about 1% per month ≈ 12% a year" (`lockgate/ideation/DECISIONS.md`, 28 Sep 2026) |
| `kinkUtilBps` | 6,667 | two-thirds, same decision note |
| `aprAtKinkBps` | 1,650 | [design] midpoint of the note's 15–18% band |
| `aprAtFullBps` | 1,800 | [design] top of that band. Nothing above 18% is invented |
| `minFeeBps` / `maxFeeBps` | 25 / 1,500 | `lockgate/SPEC.md` fee band |
| `SECONDS_PER_YEAR` | 31,536,000 | [design] ACT/365. SPEC does not name a day count |
| `timeScale` | 1 in production, 4,320 in the demo | [design] 1 wall second = 4,320 priced seconds, so 600s prices as 30 days |
| Reserve band | 500–1,000 bps | PRODUCT 5–10%. A quote outside the band is `reserve-policy` |
| Risk weights | 3,500 / 2,500 / 1,500 / 1,500 / 1,000 | [design] repayment, queue, gating, NAV, concentration. Sum 10,000 |
| `maxRiskPremiumAprBps` | 600 | [design] |
| NAV warn / max | 86,400 / 604,800 s | [design] 1 day / 7 days. Premium up to 300 APR bps between them |
| Concentration cap / premium | 2,500 bps / 200 APR bps | [design] |
| `maxTenorSeconds` | 366 days | [design] tenor uses wall-clock seconds |
| `proposalTtlSeconds` | 600 | [design] |
| `graceSeconds` | 86,400 | [design] |
| `minSamples` | 3 | [design] fewer samples score `unknownHistoryBps` 5,000, not zero |
| Unknown gate / unknown cash | 2,000 / 8,000 | [design] |
| `maxRollovers` | 36 | [design] Kasu and USD.AI state no maximum wait, so the engine refuses rather than invent one |
| NAV size | 1 USDG to 1e12 USDG | [design] 6-decimal units. Outside that range throws `amount` |

## Fee identity

Utilization APR is piecewise linear: 0 → 1,200; kink → 1,650; 10,000 → 1,800. Half-up interpolation (`lerpBps`).

```
riskApr     = roundHalfUp(riskBps * 600 / 10_000)
navApr      = 0 if age <= 1 day; else linear to 300 at 7 days
concApr     = roundHalfUp(min(exposureBps, 2500) * 200 / 2500)
totalApr    = utilizationApr + riskApr + navApr + concApr
priced      = secondsToClear * timeScale
riskFeeBps  = roundHalfUp(totalApr * priced / 31_536_000)
chargedBps  = clamp(riskFeeBps, minFeeBps, maxFeeBps)
fee         = roundHalfUp(navValue * chargedBps / 10_000)
```

Reserve required is `ceil(exposureAfter * reserveBps / 10_000)`. Exposure, limit, concentration, and reserve all use `navValue`, not `payout`.

`feeFloorSource` is `risk`, `min-fee`, or, after `applyMandateFloor`, `mandate-min`. A vault whose `minFeeBps` is above the protocol max is `mandate-min` and unavailable. The charged fee is `max(risk fee, protocol min, vault min)` and never above `maxFeeBps`.

Time-only 30 days at 1,200 bps is 99 bps: `(1200 * 2,592,000 + 15,768,000) / 31,536,000 = 99`. At 1,650 it is 136. At 1,800 it is 148. One day at 1,200 with no premium is 4 bps, then the 25 bps floor. The raw 25 bps line, still with no premium, starts at t = 643,860 seconds.

## Worked book

`monthEpoch` in `src/examples.ts`: 10,000 USDG face, cash 50,000, book 100,000, utilization 0, reserve 750 bps and 750 USDG posted, exposure 0, NAV 1 hour old, 8 clean repayments, request at the epoch start. Queue depth `10_000 / 60_000` → 1,666. Concentration `10_000 / 100_000` = 1,000 bps against a 2,500 cap → score 4,000, premium 80 APR bps. NAV score `3600 * 10_000 / 604_800` = 59. Weighted risk `(1666*2500 + 59*1500 + 4000*1000) / 10_000` = 825. Risk premium 50. Total APR 1,330. Fee 109 bps, 109,000,000 base units, floor `risk`, rollovers 0.

Same book at utilization 6,667: utilization APR 1,650, total 1,780, fee 146 bps. At 10,000: utilization APR 1,800, total 1,930, fee 159 bps. Risk stays 825 because utilization is not inside the risk score.

`weeklyClear`: request two days into a 7-day epoch, before the last 48 hours, cash covers the face. Wall wait 5 days (432,000s). Raw fee 18 bps, charged 25 (`min-fee`), fee 25,000,000.

`mapleCovered`: cash 80,000 covers the face. Assumption `maple-under-24h` (86,400s). Queue depth 1,111, risk 687, total APR 1,321, raw fee 4 bps, charged 25.

`demoTenMinutes`: wall wait 600s and `timeScale` 4,320. Priced seconds equal the 30-day epoch, so the fee is 109 bps again. Tenor checks still use the 600 wall seconds.

Queue depth sets both the rollover count and the risk score. A deep queue lengthens the wait and raises the APR. That double effect is intentional. [design]

## Hard stops

`available: false` with `blocks[]`. A refusal is a result, not an `EngineError`. Bad input throws `{ error, code }`.

`reserve-policy` if `reserveBps` is outside 500–1,000. `gated` if withdrawals are closed now (the gate component is also 10,000). `stale-nav` past `maxNavAgeSeconds`. `scan-truncated` unless `allowPartialScan` (a partial scan must not be priced as a complete queue). `illiquid` if cash is unknown on a cyclical queue, `cashPerEpoch` cannot cover the shortfall, or rollovers would exceed 36. `window-open` if the eligible window is already now. `tenor` if wall-clock wait exceeds `maxTenorSeconds`. `limit` if `exposure + navValue` exceeds the platform limit. `concentration` if exposure bps exceed the cap. `reserve` if posted cash is below the ceiling requirement. `mandate-min` as above.

## Queues

**Kasu weekly.** Docs: 7-day epoch, clearing in the final 48 hours, a request filed during clearing rolls to the next epoch, unmet amounts carry over, and a request still open after 5 epochs outranks loyalty. https://docs.kasu.finance/lending-with-kasu/understanding-epochs-and-clearing-periods/epochs.md · https://docs.kasu.finance/lending-with-kasu/withdrawing-funds · https://docs.kasu.finance/lending-with-kasu/tracking-your-withdrawal-request

On 2026-10-01 a read-only `eth_call` to Kasu system variables `0x193Bb02A24F5562b58fEB86550e6f09Bb6c41f69` on Base returned `epochDuration` 604,800 and `clearingPeriodLength` 172,800. The factory address is the one in the DefiLlama adapter: https://github.com/DefiLlama/dimension-adapters/blob/master/fees/kasu.ts. Pending pools are per strategy. The reader scans withdrawal NFTs (`totalSupply` / `tokenByIndex`, cap 100) and prices shares with ERC-4626 `convertToAssets`. A failed tranche is `queuedValue: null` and note `unpriced-tranche`. Loyalty order is not in the snapshot, so every other withdrawal is treated as ahead. The 5-epoch priority is not priced. Withdrawal id rule: `(id >> 160) >= 2^95` (Kasu `UserRequestIds`). https://github.com/Kasu-Finance/kasu-contracts

**USD.AI epoch.** Redemptions are ERC-7540, FIFO, serviced when USDai is available. `REDEMPTION_WINDOW` in source is 30 days. The protocol does not call loans to pay the queue. https://docs.usd.ai/depositor/faq/usdai-and-susdai-101 · https://github.com/usdai-foundation/usdai-contracts/blob/main/src/RedemptionLogic.sol · https://docs.usd.ai/technical-overview/contract-addresses (sUSDai `0x0B2b2B2076d95dda7817e785989fE353fe955ef9`, USDai `0x0A1a1A107E45b7Ced86833863f482BC5f4ed82EF`, Arbitrum). Default epoch is 2,592,000s. Whether day 29 is open is **[U]** in the docs read for this model. [design] the last 86,400s of the epoch are treated as closed, so a request there is due at the end of the following epoch. If `redemptionTimestamp` is already in the past, the reader rolls one epoch and notes `epoch-timestamp-in-past`. Share value is `pendingShares * redemptionSharePrice / 1e18`, then scaled to 6 decimals. Point-in-time balances from that read are not model inputs and are not TVL.

**Quarterly gated.** [design] default window 7,776,000s (90 days). A current gate is a hard stop.

**Maple fifo.** No cycle. Docs: withdrawals "under 24 hours, but could take up to 30 days", and the risk disclosure says there is no guaranteed maximum. https://docs.maple.finance/syrupusdc-usdt-usdg-for-lenders/risk · https://docs.maple.finance/integrate/ethereum-mainnet/smart-contract-integration · queue contract https://docs.maple.finance/technical-resources/withdrawal-managers/withdrawal-manager-queue · `requests` https://github.com/maple-labs/withdrawal-manager-queue. `queue()` selector is `0xe10d29ee`. If cash is known and covers face plus queue, wait is 86,400s (`maple-under-24h`). If cash is short, 2,592,000s (`maple-liquidity-short`). If cash is unknown, the same 30 days (`maple-worst-case-30d`). The Dune median is not an input. A truncated scan returns `queuedValue: null` and the quote refuses. syrupUSDC pool `0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b`, withdrawal manager `0x1bc47a0Dd0FdaB96E9eF982fdf1F34DC6207cfE3` (Ethereum). Sepolia pool `0x2d8D21FeE98d060655729eFD7b14bc432C375aC1`. On 2026-10-01 the Ethereum queue read as empty (`next = last + 1`). That snapshot is not a parameter.

Repayment history is not scraped from Kasu, Maple, or USD.AI. Adapters return queue, cash, and NAV. History comes from the engine ledger. An empty ledger pays the unknown-history premium.

## Risk score

Each component is 0–10,000, then the weighted sum is divided by 10,000, half-up.

- Repayment: if `samples < 3`, 5,000. Else `floor(lateAndSlashed * 7000 / samples) + floor(slashed * 10000 / samples)`, clamped.
- Queue: unknown cash → 8,000. Else `max(queued / (queued + cash), rollovers * 2000)`, clamped. Zero cash with a non-zero queue is 10,000.
- Gating: current gate → 10,000. No windows observed → 2,000. Else `gateEvents / windowsObserved`.
- NAV: linear in age up to the max, where it is 10,000. Age past the max is also the `stale-nav` stop.
- Concentration: `exposureBps * 10_000 / cap`. Denominator is `bookAssets` when that is larger than exposure after the advance, otherwise exposure after.

## Proposal

Domain name `LockgateAdvance`, version `1`, `chainId`, `verifyingContract` = the vault. Primary type field order matches `contracts/src/interfaces/IAdvanceProposal.sol` and `AdvanceProposalLib`:

`platform, recipient, requestId, navValue, fee, payout, feeBps (uint16), dueAt (uint64), expiresAt (uint64), nonce, quoteId (bytes32)`.

`quoteId = keccak256(abi.encode(address, uint256, uint256, uint64, uint16, uint16, uint64, uint8))` of platform, nav, fee, dueAt, risk bps, utilization bps, navUpdatedAt, kind. Kind codes: weekly 1, epoch 2, quarterly 3, fifo 4. The investor address is not in the struct. `requestId` binds the queue item and must be non-zero to submit. `expiresAt = min(now + 600, mandate.expiresAt)`. `dueAt` is a unix timestamp. Calldata is `submitProposal(tuple, bytes)`. The signature is `0x` until signed. Signing reads a hex key from an environment variable name. The key is never written to JSON. Logs redact fields whose names match `key`, `secret`, `private`, or `signature`. The engine refuses to sign a proposal that is not submittable, and refuses to build one for a forbidden chain (1, 10, 50, 56, 137, 8453, 42161, 43114, 98866). Local 31337, Arbitrum Sepolia 421614, and Ethereum Sepolia 11155111 are allowed. Reading public contracts on a forbidden chain is allowed. Building a digest is not a broadcast.

The partner vault in `contracts/src/partner/libraries/AdvanceHash.sol` hashes a different type (`LockgatePartnerVault`, extra `vault`, `exitRef`, `deadline`, no `requestId` / `payout` / `feeBps` / `quoteId`). Those digests do not match. See `contracts/INTERFACE-REQUESTS.md`. Until G6 picks one schema, this engine signs the G6 struct only.

Router policies: `lowest-fee` (mandate `minFeeBps`, then idle), `most-capacity` (idle), `round-robin` (cursor). A vault is eligible when the mandate is unexpired, its min fee is within the protocol max, idle covers `navValue`, and the platform is approved.

## Sweep, alerts, backtest

`repay(uint256)` and `markLate(uint256)` match `ILockgateCreditLine` and `IPartnerVault`. Before `dueAt`: pending. After `dueAt + grace`: `markLate`. Inside grace with unknown or short cash: wait, and do not send a `repay` that would revert. Inside grace with cash covering `navValue`: `repay`. Partner actions carry calldata and `sendable: false`. `broadcastOwnBook` throws if a partner action is sendable, and throws `mainnet-forbidden` on a forbidden chain. Default is plan-only.

Alerts are in-process records (`info`, `warn`, `critical`). There is no email, webhook, or Telegram send.

The backtest threads repayment history across ticks only. Exposure, reserve, and cash are whatever the tick says. They are not rolled. Fee is counted as earned only on `repay` (it is withheld at draw). Slash loss is `max(0, payout − min(reserveBalance, navValue))`. A `refuse` outcome matches an unavailable quote. Named scenarios: `epoch-repay`, `kasu-repay-slash`, `gated-refuse`, `stale-refuse`, `reserve-short`, `busy-book`.

## CRE

`runCreTick` is the local stand-in for a Chainlink CRE cron. It does not import `@chainlink/cre-sdk` and does not broadcast. The cron shape it stands in for is `CronCapability.trigger({ schedule })`, minimum 30 seconds: https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts · https://docs.chain.link/cre/reference/project-configuration-ts. See `cre/CRE.md`.

## Non-goals

No partner key. No mainnet send. No position transfer, pooled public deposit, or synthetic token. No per-deal technology fee inside this quote. No use of a live TVL figure as a parameter.
