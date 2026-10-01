# Security notes — engine

## SUMMARY

Reviewed the off-chain engine on 2026-10-02 against access control, reentrancy, rounding, oracle staleness, signature replay, denial of service, griefing, and economic attacks. Twelve findings were fixed in `engine/` and covered by `engine/test/security.test.ts`. The partner vault remains the backstop: `submitProposal` stores a digest and moves no tokens; `approve` and `execute` re-check the mandate. This is not a pentest and not a legal opinion.

## Findings

| Id | Class | What was wrong | Fix |
|---|---|---|---|
| E-1 | Access | `assertTransactableChain` refused nine named chains and allowed every other id, so a signature could be built for an unnamed network. | Allow only 31337, 421614, and 11155111. |
| E-2 | Access | `broadcastOwnBook` sent whatever calldata was on a row marked `own-book`, to whatever address that row named. A partner vault shares `repay` and `markLate` selectors. | Send only those two selectors, for that advance id, to the credit line the caller names. |
| E-3 | Replay | One sweep could list the same advance twice, and the sender callback could call `broadcastOwnBook` again. | Reject duplicate sendable ids before any send. A module flag rejects re-entry. |
| E-4 | Griefing | The signed recipient was not checked. `submitProposal` stores the digest before `preview`. A recipient the vault will reject occupies `proposalHash[nonce]` until the owner cancels. | Recipient must be the platform, or `payoutTo` when the mandate sets one. Matches `MandateLogic`: an unset payout address means the platform. |
| E-5 | Griefing | Signing did not see vault idle or `totalAssets`. A proposal could pass the engine and fail `Cash` or `Concentration` after the nonce was pinned. | Idle and vault assets are required. Payout above idle, or nav above `floor(totalAssets * concentration / 10000)`, is not submittable. |
| E-6 | Economic | `allowPartialScan` let a truncated queue be priced and signed. Depth is a lower bound, so the wait and the fee are too small. | A quote may still show the flag. `buildProposal` refuses every truncated scan. |
| E-7 | Economic | `JSON.parse` rounds numbers past 2^53, and `zAmount` accepted the rounded value. A large nav could be signed as a different amount. | Unsafe numbers throw. Amounts past that range must be decimal strings. |
| E-8 | Rounding | `toUsdg6` rounded half-up. Cash could look larger than the token balance, and a queue could look smaller. | Queued amounts ceil. Cash and NAV floor. sUSDai share value ceils before the decimal scale. |
| E-9 | DoS | `maxScan` was caller-controlled and the Kasu and Maple readers looped that many RPC calls. | Hard cap 256. A longer queue is truncated, and a truncated scan is not signed. |
| E-10 | Oracle | `now` is caller-supplied. A clock set far ahead makes a stale NAV or a stale peg look fresh, and the signature's expiry moves with it. | A quote more than one day ahead of this machine is not signed. |
| E-11 | Griefing | A 100% mandate floor signed `fee == nav`. The vault rejects that as `Zero` after submit. | A fee that leaves no payout is not submittable. The signed fee must also be at least `floor(nav * minFeeBps / 10000)`, which is `FeeMath.minFee`. |
| E-12 | Replay | `filePartnerProposal` attached any byte string as the signature. A signature over a different message still recovers, to some other address. | The recovered address must be the proposer named by the caller. A mismatch does not call the sender. |

## Reviewed, no code change

- Peg check: a future update, `maxOracleAge` of 0, or an age past the max is `stale-oracle`. A price below `minPriceE8` is `peg`. Stale wins, so the two are not stacked. A disabled or omitted oracle is not a depeg. The vault's `_oracleReason` uses the same order.
- Reserve requirement uses ceiling division, matching `MandateLogic`'s `Rounding.Ceil`.
- Facility interest is the double floor in `FacilityMath`: `floor(floor(principal * apr / 10000) * dt / 31536000)`. Draws stay on the facility. The engine does not send them.
- The EIP-712 domain is `LockgateAdvance` version `1`, bound to chain id and the vault. `filePartnerProposal` encodes `submitProposal` only.
- Partner sweep rows stay `sendable: false`. The engine does not encode `execute`, `approve`, or a partner `markLate`.
- Engine fee rounding is half-up, which is at least the vault's floored minimum, so the signed fee is not one unit under `FeeMath.minFee`.
- Maple cash stays unknown. The reader does not treat `lockedLiquidity` as spendable.

## Residual

- Utilization, cash, NAV, and the vault snapshot are operator inputs. A lied snapshot can still be signed. The vault re-checks at `approve` and `execute`.
- `quoteId` does not include nonce, recipient, or vault. Repayment routing must use the full advance, not `quoteId` alone.
- The engine does not store nonces. A filed proposal that later fails `preview` still occupies that nonce until the vault owner cancels it.
- The one-day clock bound can hide one day of NAV or oracle age.
- A scan longer than 256 entries is refused rather than fully priced.
- `broadcastOwnBook` can still send `repay` and `markLate` on the named credit line. It cannot send any other selector.
