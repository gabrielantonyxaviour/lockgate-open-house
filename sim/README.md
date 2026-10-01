# SUMMARY

150 paths finished (10 seeds × 3 stages × 5 shocks, 360 days). Residual 0, repay-first breaches 0, fees inside 25–1500 bps, and 0 partner tokens moved to Lockgate. Senior was impaired on 0 of 150 paths. Tables are in `RESULTS.md`. Charts are `charts/allocation.png`, `charts/losses.png`, `charts/utilization.png`, and `charts/yield.png`.

Stage 3 fee yield is gross exit fees divided by average equity. That equity is 500,000 USDG, levered by the senior and junior facility. The percentage is not a net return. Facility interest is reported beside it and is not subtracted.

# PROGRESS

- 2026-10-02: `npm test` from this directory, 23 tests passed. Exposure for limits, concentration, and the reserve is owed nav, and the reserve rounds up. Interest already paid is not equity in a write-off. `npm run sim` was re-run. `RESULTS.md` still shows senior impaired on 0 of 150 paths. The runner throws if the accounting identity, repay-first order, fee band, or Lockgate sweep check fails.

# Run

```
cd lockgate/repo/sim
npm test
npm run sim
python3 chart.py
```

`chart.py` reads `out/summary.json` and writes the PNGs. `out/` is a run artifact and is not committed.

The integer curve in `src/pricing.ts` is the simulator's curve. It floors the zero-risk 600s × 4320 case to 98 bps and clamps to 25–1500. The on-chain `PricingMath` half-up of that case is 99 bps and refuses a fee above the max. Those numbers are not interchangeable. Scenario sizes, arrival rates, and the stage-3 coupons are labeled as assumptions in `RESULTS.md`.
