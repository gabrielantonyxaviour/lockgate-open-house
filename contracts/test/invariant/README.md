# SUMMARY

Stage-1 solvency, repay-first, fee bounds, partner key separation, and the stage-3 junior-before-senior waterfall. The subjects are the contracts in `src/`. There is no parallel reference copy.

# PROGRESS

- 2026-10-02: `FOUNDRY_TEST=test/invariant forge test` from `contracts/`. 19 tests passed, 0 failed. Configured fuzz is 256 runs. The invariant is 40 runs, depth 25, `fail_on_revert = false`. The five stage-1 handlers recorded 0 reverts on that run. Handler draws refresh the window to 120–800 seconds because a 7-day window at `timeScale` 4320 is above `maxFeeBps` and the chain refuses it.

# What is checked

- `accountedAssets() == accountedEquity()` when the handler does not donate tokens. Unpaid principal matches `outstanding`. Remaining nav matches `totalExposure`. Investor balances match what draws paid them.
- A 600-second, zero-utilization quote is 99 bps. A 7-day quote is unavailable with reason `fee above max`, not clamped.
- Repay pulls the platform, not the investor. A gated or paused source cannot draw. A stranger cannot withdraw capital.
- Lockgate cannot withdraw, change the mandate, or upgrade a partner vault. A bad engine signature and a replay do not move funds. An unapproved platform does not move funds. Repayment returns to that vault. The router ends at a 0 balance.
- Facility: a draw above the borrowing base reverts. A stranger cannot draw. On a breach, junior cash pays senior drawn before `recognizeLoss` writes down senior principal.

`CreditLineBook` reads `eligibleOutstanding` and `lateOutstanding` on the stage-1 line. After a 10,000e6 draw those are the nav and 0, and they sum to `totalExposure`. The facility waterfall tests still use `mocks/ReceivablesBook.sol` so a partner vault is not the book.

Run this suite with `FOUNDRY_TEST=test/invariant forge test` from `contracts/`. That command does not execute `test/partner` or `test/facility`.
