# SUMMARY

Oracle and price shocks on seed 20261001, 360 days, stages 1–3. The USDC depeg shock prices injected window cash at 98999999, one unit under the 99000000 floor, and refuses a new advance with peg. A stale price keeps that cash at par and refuses a new advance with stale-oracle. Days 120–150 are the shock. Days outside it are open. The check order matches engine/src/pricing/peg.ts, so a stale print is not also reported as a peg. IPegOracle is a USDG/USD price, 1e8 = $1, and the engine reports a price under the floor as "USDG is below the peg floor". This sim does not call latest(). 98999999 is the floor minus one unit, not a market print and not a forecast. The 0.92 window-cash depeg is a different scenario and is not applied here.

Coverage is floor(reserve absorbed × 10000 / credit loss). A path with no credit loss is no loss. Posted reserve is cash still reserved plus cash the reserve already absorbed.

```mermaid
flowchart LR
  price[USDC price under the floor] --> haircut[Window cash times that price]
  price --> stop[New advances refused]
  stale[Oracle age one second past 1 day] --> stop2[New advances refused]
  stale --> par[Window cash stays at par]
```

| Shock | Stage | Advances | Peg refusals | Stale refusals | Credit loss | Reserve absorbed | Reserve posted | Coverage bps |
|---|---|---|---|---|---|---|---|---|
| baseline | stage1 | 3500 | 0 | 0 | 0 | 0 | 405000000000 | no loss |
| usdc-depeg | stage1 | 3226 | 293 | 0 | 0 | 0 | 405000000000 | no loss |
| stale-price | stage1 | 3226 | 0 | 293 | 0 | 0 | 405000000000 | no loss |
| default | stage1 | 2958 | 0 | 0 | 167502908000 | 37505576100 | 405000000000 | 2239 |
| default-usdc-depeg | stage1 | 2729 | 293 | 0 | 167502908000 | 37505576100 | 405000000000 | 2239 |
| default-stale-price | stage1 | 2729 | 0 | 293 | 167502908000 | 37505576100 | 405000000000 | 2239 |
| baseline | stage2 | 3488 | 0 | 0 | 0 | 0 | 354869400000 | no loss |
| usdc-depeg | stage2 | 3213 | 293 | 0 | 0 | 0 | 352092275000 | no loss |
| stale-price | stage2 | 3213 | 0 | 293 | 0 | 0 | 350472175000 | no loss |
| default | stage2 | 2947 | 0 | 0 | 167047743500 | 10895675000 | 328017325000 | 652 |
| default-usdc-depeg | stage2 | 2717 | 293 | 0 | 167047743500 | 10895675000 | 322640950000 | 652 |
| default-stale-price | stage2 | 2717 | 0 | 293 | 167047743500 | 10895675000 | 322501800000 | 652 |
| baseline | stage3 | 3500 | 0 | 0 | 0 | 0 | 405000000000 | no loss |
| usdc-depeg | stage3 | 3226 | 293 | 0 | 0 | 0 | 405000000000 | no loss |
| stale-price | stage3 | 3226 | 0 | 293 | 0 | 0 | 405000000000 | no loss |
| default | stage3 | 2958 | 0 | 0 | 163984141100 | 37505576100 | 405000000000 | 2287 |
| default-usdc-depeg | stage3 | 2729 | 293 | 0 | 163984141100 | 37505576100 | 405000000000 | 2287 |
| default-stale-price | stage3 | 2729 | 0 | 293 | 163984141100 | 37505576100 | 405000000000 | 2287 |

stage1 clean coverage is no loss (USDC no loss, stale no loss). Default coverage is 2239 and stays the same under both shocks. Posted reserve has 1 distinct value. stage2 clean coverage is no loss (USDC no loss, stale no loss). Default coverage is 652 and stays the same under both shocks. Posted reserve has 6 distinct values. stage3 clean coverage is no loss (USDC no loss, stale no loss). Default coverage is 2287 and stays the same under both shocks. Posted reserve has 1 distinct value. USDC depeg peg refusals are 293 and stale refusals are 0. Stale-price stale refusals are 293 and peg refusals are 0.

A price equal to the floor is still good. One unit under it is peg. An age equal to 1 day is still fresh. One second later is stale-oracle, including when the price is also under the floor.

