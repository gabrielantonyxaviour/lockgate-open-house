# Security notes — stage-1 core contracts

## SUMMARY

Reviewed the stage-1 credit line, reserve, sandbox queues, factory, pricing guardrails, open vault, and exit pool on 2026-10-02. The pass covered access control, reentrancy, rounding, oracle staleness, signature replay, denial of service, griefing, and economic attacks. Five findings were fixed in `contracts/src/core` and `contracts/src/interfaces/ILockgateCreditLine.sol`. Regressions are in `contracts/test/core/Security.t.sol`. The queue invariant also checks the open-request list. This is not a pentest and not a legal opinion. `PricingMath` is unchanged: 600 seconds is still 99 bps.

## Findings

| Id | Class | What was wrong | Fix |
|---|---|---|---|
| C-1 | Economic | `markLate` used the live `grace`. After a draw, the owner could `setGrace(0)` and slash the platform reserve at `dueAt`, before the grace the advance was drawn under. | The grace is stored on the advance at draw. Read it with `graceOf(id)`. `grace()` is the value the next draw will store. `getAdvance` is unchanged. |
| C-2 | Access | `registerSource` let any registrar overwrite `limit` and `reserveBps` on a source that was already registered. A registrar could set the reserve to 0 while the advance was open, and the platform admin could then withdraw the first-loss cash. | A registrar that calls `registerSource` again reverts `AlreadyRegistered`. The owner can still re-register. Term changes otherwise go through `setSourceTerms`. |
| C-3 | Rounding | Utilization and concentration used integer division that rounds down. A cap of 0 still allowed a draw whose principal was just under 1 bp of capital. One unit over a concentration cap could floor back onto the cap and pass. | Both checks use OpenZeppelin `Math.mulDiv` with `Rounding.Ceil` (<https://docs.openzeppelin.com/contracts/5.x/api/utils#Math>). A ratio above the cap is refused. An exact cap still passes. |
| C-4 | DoS | `processWindow`, `lockgateOwed`, and `headRequestId` looped every request ever opened, and `advancesOf` copied every advance. Anyone who can deposit is allowlisted and can queue. Enough requests make settlement run out of gas. The window then cannot repay, and `markLate` slashes the reserve. | Open requests sit on a list capped at `MAX_OPEN` (128). Settlement, the head, the owed view, and the FIFO preview walk that list. Settled history is unlinked. The 129th open request reverts `QueueFull`. |
| C-5 | Economic | `UsdgTransfers.pull` rejected a short receipt. `push` did not. A fee-on-transfer token could pay the investor, the owner, or a slashed reserve less than the books recorded. | `push` reverts `FeeOnTransfer` unless the recipient balance rises by the full amount. |

## Reviewed, no code change

- `withdrawCapital` can take the cash that was not sent to the investor. That cash is not earned fee yet. `free` is `deposited + earnedFees - withdrawn - outstanding`. After a draw, `outstanding` is the principal, so the unsent fee cash is idle capital. Repayment brings the obligation back. A donation does not increase `accountedEquity`. The existing withdraw tests still describe this.
- `repay` is permissionless and pulls the remainder from the source, which approved the line. It cannot pull more than the open obligation. `processWindow` and the exit pool depend on that. Pausing does not block repay or `markLate`.
- `draw`, `repay`, `markLate`, capital moves, and `postReserve` are `nonReentrant`. State for a draw is stored before the token move. The callback test in `test/invariant/Reenter.t.sol` still expects a second draw during payout to revert. Reserve `post`, `withdraw`, and `slash` are also guarded, so a token callback cannot reenter the reserve while it is inside one of those calls.
- `markLate` slashes while the advance is still `Active`, so `_applyRecovery` reduces `eligibleOutstanding`. Whatever remains then moves to `lateOutstanding`. A full slash leaves `lateOutstanding` unchanged. A second `markLate` reverts `BadStatus`.
- `postReserve` is permissionless and credits the named source. That is a donation. The platform admin can withdraw only down to `requiredReserve`. The reserve owner cannot withdraw platform funds. `setCreditLine` is once. `setSlasher` works until `lockSlasherSet`.
- Stage 1 does not check `AdvanceProposalLib`. There is no signature to replay on this book. The domain `LockgateAdvance` version `1` is unchanged for the partner vault.
- There is no external price oracle. The issuer sets `nav` and `navUpdatedAt`. A future timestamp is quote code 6. Age past `maxNavAge` is code 13. `draw` passes `depeg = false`. Peg checks stay in the engine and the facility.
- The exit pool stores `readyAt` from the cooldown at sell time, and the advance stores `dueAt` from `nextWindow()` in that same call. A later `setCooldown` does not move either. `sellToLockgate` passes the quoted fee as `maxFee`. In one transaction the timestamp does not change, so the charge matches the quote. A later block has a shorter wait on this curve, so the fee falls. A higher fee reverts `FeeTooHigh`.
- Open-vault share price uses the accounted `assets`, not the raw token balance. A donation does not inflate the price. Withdrawals store `readyAt`. `claim` pays `item.owner`.
- Deposits on a sandbox fund allowlist the caller. A gate blocks new exits and does not block deposits. That is the path `test_gateBlocksRedeemNotDeposit` locks. Share math rounds down, so dust stays in the fund.
- The factory still clones and calls `initialize` in one transaction. The implementation is locked with a zero token. `registerSource` from that factory still runs for a new clone.

## Residual

- `createPlatform` is permissionless and, once the owner has called `setRegistrar(factory)`, registers the caller as issuer with the caller's limit and reserve bps, including 0. That issuer can `setNav` and `exitNow` up to the limit. The line does not compare the reported NAV with cash. Door 2 also registers at reserve bps 0, which is the open-token path. Do not leave capital on a line whose registrar is an open factory unless those issuers are trusted.
- `graceOf` on an unknown id is 0. A draw made while `grace` is 0 also stores 0. Read `getAdvance` before treating 0 as "slash at `dueAt`".
- `setParams`, `setSourceTerms`, `setNav`, and `setGrace` (for a later draw) apply on the next call. None of them waits.
- Slashers are not locked in the constructor. The owner has to call `lockSlasherSet` after the credit line is named. Until then the owner can add another slasher, and that address receives the slashed tokens.
- A full open list blocks new redeems until some are cancelled or the window settles them. Filling it costs 128 real requests, not a gas bomb.
- `push` refuses a recipient whose balance does not rise by the full amount. A contract that forwards the tokens during `transfer` cannot receive a draw, a withdrawal, or a slash.
- Queue dust that buys zero shares is left queued. Pro-rata rounding can leave cash in the platform. Neither path pays that dust out.
- The on-chain fee is a ceiling. The engine's fee is half-up. This pass did not retune either one.
