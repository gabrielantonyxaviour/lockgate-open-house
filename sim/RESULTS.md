# SUMMARY

Reference book, 360 days, 36 platforms, 10 seeds, stages 1–3, five shocks. Every completed path kept the accounting identity, repaid advances before waiting investors, charged 25–1500 bps, and moved 0 partner-vault tokens to Lockgate. The runner throws on a breach, so a finished table is the check.

Illustrated seed 20261001, stage 1 baseline: 3,500 advances out of 5,140 exit requests, peak utilization 50.99%, annualized exit-fee yield 22.13% on average equity, credit losses $0.00. The same seed's bank-run peaks at 85.53% utilization. Stage 2 baseline invoices $72,000.00 as a flat technology fee and does not sweep it from the vaults. Stage 3 bank-run senior loss on that seed is $0.00; senior was impaired on 0 of 150 paths, and only after junior was exhausted.

Stage 3 fee yield is gross exit fees divided by average equity value. That equity is 500,000 USDG, levered by the senior and junior facility. The percentage is not a net return. Facility interest is reported beside it and is not subtracted.

These are outputs of the assumptions below. They are not a forecast and not a measured market.

## Setup

Platforms follow the queue shapes in the product notes. Eighteen clear weekly, the way Kasu's pending pool pays from excess cash on a weekly cycle. Twelve clear on a 30-day epoch, the cadence of the USD.AI queue write-up. Six are quarterly and can pay at most 5% of an assumed 800,000 USDG book each window, from the internal decision to treat large gated funds as a 5%-a-quarter redemption. Sources are listed at the bottom.

Each day, redemption requests arrive, 70% ask to exit early, and the rest wait. A window injects cash against what is due, pays Lockgate advances FIFO, and only then pays waiting investors. Unpaid advances roll to the next window. They are written off after a miss limit and a 2-day grace: 8 misses in the baseline, 1 for the four named defaulters, 3 in the depeg, 2 in the bank-run. A write-off takes that platform's own reserve first, then junior cash, junior principal, equity, and senior.

Stage 1 is Lockgate's own 4,000,000 USDG. Stage 2 is three partner vaults of 900,000 USDG each (Harbour weekly, Keppel weekly and epoch, Marina all queues). The router takes the lowest fee that clears the mandate. Stage 3 is 500,000 USDG of equity plus a facility (senior 1,500,000 USDG at 8%, junior 400,000 USDG at 15%, advance rate 80% of principal). Coupons, the advance rate, the 2,000 USDG per vault per 30 days technology invoice, and the premium slopes are assumptions. The 12% APR, the 25/1500 bps band, the 5–10% reserve and the flat (not per-deal) fee are from the product documents.

## Median across seeds

Advances funded:

| | baseline | gating | default | depeg | bank-run |
|---|---:|---:|---:|---:|---:|
| stage1 | 3,503 | 3,397 | 2,953 | 3,496 | 3,916 |
| stage2 | 3,490 | 3,389 | 2,945 | 3,490 | 3,880 |
| stage3 | 3,503 | 3,397 | 2,924 | 3,496 | 2,508 |

Peak utilization:

| | baseline | gating | default | depeg | bank-run |
|---|---:|---:|---:|---:|---:|
| stage1 | 48.97% | 46.74% | 50.19% | 48.77% | 88.78% |
| stage2 | 64.19% | 60.28% | 66.22% | 64.38% | 97.19% |
| stage3 | 85.61% | 80.05% | 83.48% | 85.61% | 99.99% |

Annualized exit-fee yield on average equity value. Stage 2 is the partners' yield. Lockgate's stage-2 income is the flat invoice, not this column:

| | baseline | gating | default | depeg | bank-run |
|---|---:|---:|---:|---:|---:|
| stage1 | 21.64% | 19.24% | 19.45% | 21.61% | 25.25% |
| stage2 | 32.13% | 29.97% | 29.85% | 32.22% | 36.75% |
| stage3 | 125.81% | 125.63% | 116.99% | 125.71% | 95.97% |

Credit loss (reserve absorbed + junior + equity credit loss + senior), median:

| | baseline | gating | default | depeg | bank-run |
|---|---:|---:|---:|---:|---:|
| stage1 | $0.00 | $0.00 | $198,974.55 | $48,940.15 | $374,441.02 |
| stage2 | $0.00 | $0.00 | $198,462.29 | $0.00 | $207,314.62 |
| stage3 | $0.00 | $0.00 | $195,182.46 | $48,273.02 | $390,307.69 |

Stage 3 also pays facility interest out of equity. Median interest and median senior loss:

| | median interest | median senior loss | paths with senior loss |
|---|---:|---:|---:|
| baseline | $134,400.22 | $0.00 | 0/10 |
| gating | $118,923.81 | $0.00 | 0/10 |
| default | $114,945.82 | $0.00 | 0/10 |
| depeg | $134,332.50 | $0.00 | 0/10 |
| bank-run | $139,380.13 | $0.00 | 0/10 |

## Illustrated seed

| stage | shock | advanced | peak util | fee yield | reserve | junior | equity loss | senior | tech fee |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| stage1 | baseline | 3500 | 50.99% | 22.13% | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 |
| stage1 | gating | 3390 | 49.16% | 19.73% | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 |
| stage1 | default | 2958 | 50.23% | 19.52% | $37,505.57 | $0.00 | $129,997.33 | $0.00 | $0.00 |
| stage1 | depeg | 3495 | 51.64% | 22.08% | $37,443.91 | $0.00 | $71,541.35 | $0.00 | $0.00 |
| stage1 | bank-run | 3791 | 85.53% | 23.96% | $67,500.00 | $0.00 | $263,080.48 | $0.00 | $0.00 |
| stage2 | baseline | 3488 | 65.17% | 32.59% | $0.00 | $0.00 | $0.00 | $0.00 | $72,000.00 |
| stage2 | gating | 3371 | 66.21% | 30.30% | $0.00 | $0.00 | $0.00 | $0.00 | $72,000.00 |
| stage2 | default | 2947 | 65.84% | 29.83% | $10,895.67 | $0.00 | $156,152.06 | $0.00 | $72,000.00 |
| stage2 | depeg | 3489 | 66.05% | 32.67% | $0.00 | $0.00 | $0.00 | $0.00 | $72,000.00 |
| stage2 | bank-run | 3763 | 95.94% | 35.32% | $50,814.27 | $0.00 | $154,943.29 | $0.00 | $72,000.00 |
| stage3 | baseline | 3500 | 91.02% | 126.64% | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 |
| stage3 | gating | 3390 | 86.80% | 126.97% | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 |
| stage3 | default | 2958 | 87.49% | 119.75% | $37,505.57 | $126,478.56 | $0.00 | $0.00 | $0.00 |
| stage3 | depeg | 3495 | 91.02% | 125.88% | $37,260.83 | $70,208.21 | $0.00 | $0.00 | $0.00 |
| stage3 | bank-run | 2447 | 100.00% | 94.51% | $67,500.00 | $270,005.30 | $0.00 | $0.00 | $0.00 |

Stage 1 baseline rejections on the illustrated seed:

- over-limit: 75

## Charts

![Stage 1 utilization](charts/utilization.png)

![Stage 1 cumulative credit loss](charts/losses.png)

![Median annualized exit-fee yield](charts/yield.png)

![Bank-run loss allocation on the illustrated seed](charts/allocation.png)

## Reproduce

```
cd lockgate/repo/sim && npm test && npm run sim
```

## Sources

- 12% APR, 25 bps floor, 1500 bps cap, demo time scale 4320, repay-first window, 7.5% reserve seed, USDG address: `lockgate/SPEC.md`.
- About 1% per month and the 5%-a-quarter gated-fund decision: `lockgate/ideation/DECISIONS.md` (28 Sep and 27 Sep 2026).
- Stages, 5–10% first-loss reserve, flat technology fee, Lockgate holds no partner keys: `briefs/grok/PRODUCT.md`.
- Kasu weekly cycle, positions not transferable: [PendingPool.sol](https://github.com/Kasu-Finance/kasu-contracts/blob/master/src/core/lendingPool/PendingPool.sol), discussed in `research/lockgate-exit-precedents.md`.
- USD.AI monthly queue (QEV still described as not implemented): [queue-extractable-value](https://docs.usd.ai/depositor/susdai/queue-extractable-value.md).
- Global Dollar (USDG) on Arbitrum Sepolia, 6 decimals, proxy at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`: [Arbiscan](https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892). On 2026-10-01, `cast` against `https://sepolia-rollup.arbitrum.io/rpc` at block 314719112 returned symbol USDG, decimals 6, totalSupply 2111011000100 (2,111,011.0001 USDG), chain id 421614.
