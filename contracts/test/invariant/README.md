# SUMMARY

Stage-1 solvency, repay-first, fee bounds, partner key separation, and the stage-3 junior-before-senior waterfall. The subjects are the contracts in `src/`. There is no parallel reference copy.

# PROGRESS

- 2026-10-02: `FOUNDRY_TEST=test/invariant forge test` from `contracts/`. 38 tests passed, 0 failed. Fee fuzz is 1024 runs. The draw-or-revert fuzz is 512 runs. Both invariants are 64 runs, depth 40, `fail_on_revert = false`. The stage-1 handler and the partner handler each recorded 2560 calls and 0 reverts. Handler draws refresh the window to 120–800 seconds because a 7-day window at `timeScale` 4320 is above `maxFeeBps` and the chain refuses it.

# What is checked

- `accountedAssets() == accountedEquity()` when the handler does not donate tokens. Unpaid principal matches `outstanding`. Remaining nav matches `totalExposure`. Investor balances match what draws paid them.
- A 600-second, zero-utilization quote is 99 bps. A 7-day quote is unavailable with reason `fee above max`, not clamped.
- Repay pulls the platform, not the investor. A gated or paused source cannot draw. A stranger cannot withdraw capital.
- Lockgate cannot withdraw, change the mandate, or upgrade a partner vault. A bad engine signature and a replay do not move funds. An unapproved platform does not move funds. Repayment returns to that vault. The router ends at a 0 balance.
- Fee edges: gated beats every other input. NAV age of exactly 7 days is not stale; one second later is `stale nav`. Tenor of exactly 366 days is priced, and one second later is `tenor`. A 7-day wait is `fee above max` at 1500 bps, not clamped. `feeFromBps` rounds up. A zero address and an 18-decimal token are rejected.
- Stage-1 refusals leave capital in place: zero, window due, unregistered, a future NAV time, the stale boundary, tenor, fee above max, over limit, a 1-unit fee that consumes the advance, reserve, utilization, concentration, capital, and pause. A second repay and an unknown id revert. Marking late one second early reverts; at `due + grace` an uncovered advance moves the whole nav into `lateOutstanding`. A callback during payout cannot draw again. A transfer that arrives one unit short does not repay.
- Partner vault invariant: token balance equals idle plus reserve cash, outstanding principal matches the open advances, and the platform's balance equals what it was paid. Lockgate cannot withdraw, skim, change the mandate, pause, or upgrade. An unapproved platform and a Lockgate recipient move nothing. A donation stays in the vault until the partner skims it. The router ends at 0.
- Facility: the governor is not the borrower, and the governor cannot draw. A draw above the borrowing base reverts. A stranger cannot draw. On a breach, junior cash pays senior drawn before `recognizeLoss` writes down senior principal.

`CreditLineBook` reads `eligibleOutstanding` and `lateOutstanding` on the stage-1 line. After a 10,000e6 draw those are the nav and 0, and they sum to `totalExposure`. The facility waterfall tests still use `mocks/ReceivablesBook.sol` so a partner vault is not the book.

Run this suite with `FOUNDRY_TEST=test/invariant forge test` from `contracts/`. That command does not execute `test/partner` or `test/facility`.
