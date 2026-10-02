# SUMMARY

Adversarial actors against the current router and mandate shape. 3 attacks. 1 broke the invariant it names. This is not a pentest and not a legal opinion. No contract source was changed.

The front-run is the same shape as `contracts/test/invariant/Adversarial.t.sol`: two vaults fund one quoteId, and `relayRepay` of index 0 leaves the other vault open. Taking the shared idle, and a mandate abuse, do not pay an advance the rails refuse.

| Id | Kind | Broke | Invariant |
|---|---|---|---|
| front-run-repay | front-run | yes | one relayRepay clears every vault that funded the quoteId |
| grief-idle | griefing | no | a later platform cannot be paid with cash an earlier advance already took |
| mandate-abuse | mandate | no | an unapproved platform, a fee under the floor, or a late tenor moves no advance |

## front-run-repay

- grief vault funds 100000000 owed first, so it is record 0
- honest vault funds 1000000000 owed as record 1
- relayRepay(index 0) pays 100000000 to grief
- a second relayRepay of index 0 is empty
- still open: honest

## grief-idle

- attacker draw of 9900 principal is accepted
- idle left 100
- victim principal 200 is capital-short
- attacker one more unit is over-limit

## mandate-abuse

- stranger platform is mandate-platform
- 24 bps on an approved platform is mandate-fee
- tenor one second over the max is mandate-tenor
- paying investors while an advance is open is a breach
- holding that payment back is within the rule
