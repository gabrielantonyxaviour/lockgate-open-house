# SUMMARY

One engine proposal was executed on local Anvil, chain 31337, block 1965. The vault funded the signed fee. The sim, the engine, and the on-chain curve do not return the same bps for a 600-second window. 4 divergences. 0 integration breaks. The chain was not reset and was not warped.

# Agreements

Vault fee 101000000 equals the signed engine fee 101000000.
Vault principal 9899000000 equals the signed payout 9899000000.
Idle fell from 80000000000 to 70101000000, then repay left it at 80101000000.
Lockgate's token balance stayed 0.

# Divergences

## fee-bps-600s

the same 600-second window is priced at three different bps

| Leg | Value |
|---|---|
| Sim | 98 bps, fee 98000000, raw 98, age-3600 98 |
| Engine | 101 bps, fee 101000000, pricedSeconds 2592000, apr 1225, risk 276 |
| Chain | 99 bps, fee 99000000, refusal none |

Repro: nav 10000000000, seconds 600, timeScale 4320, now 1790907499, block 1965. Sim riskBps is 10000 (a 1.0x multiplier on the APR) and nav age 0. Chain feeBps passes platform risk 0. Engine scores its own risk and uses navUpdatedAt = now - 3600.

## fee-rounding

fee amount at 99 bps on nav 1000001

| Leg | Value |
|---|---|
| Sim | 9901 |
| Engine | half-up 9900, ceil 9901 |
| Chain | 9901 |

Repro: PricingEngine.feeFromBps and the sim both ceil. Engine mulDivRoundHalfUp is the signed fee. Nav 1000001 is not a multiple of 10000.

## fee-bps-full-util

a 600-second window at 10000 utilization bps

| Leg | Value |
|---|---|
| Sim | 598 |
| Engine | 150 |
| Chain | 148 |

Repro: nav 10000000000, seconds 600, timeScale 4320, now 1790907499, block 1965, utilizationBps 10000. This row is a quote and was not funded. The sim adds the utilization premium after the time fraction. The chain and the engine add a utilization APR and then scale by time.

## idle-versus-sim

vault idle after repay is the deposit plus the engine fee, not the sim fee

| Leg | Value |
|---|---|
| Sim | 80098000000 |
| Engine | 80101000000 |
| Chain | stage 2 does not charge the credit-line curve |

Repro: nav 10000000000, seconds 600, timeScale 4320, now 1790907499, block 1965. Idle before 80000000000.


# Command

```
cd lockgate/repo/e2e
npm run compare
```
