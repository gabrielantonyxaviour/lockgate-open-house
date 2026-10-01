# Security notes — testing

## SUMMARY

Reviewed the simulator, the local end-to-end runner, and the invariant and fork suites on 2026-10-02. The pass covered access control, reentrancy, rounding, oracle staleness, signature replay, denial of service, griefing, and economic attacks. Seven findings were fixed under `sim/`, `e2e/`, and `contracts/test/invariant/CrossVaultReplay.t.sol`. Regressions are in `sim/test/books.test.ts`, `sim/test/failures.test.ts`, `sim/test/queue.test.ts`, `e2e/test/security.test.ts`, and that Foundry file. The stage-2 runner also rejects a signature copied onto the other partner vault. This is not a pentest and not a legal opinion. No contract source was changed.

## Findings

| Id | Class | What was wrong | Fix |
|---|---|---|---|
| T-1 | Economic | Limits, concentration, and the first-loss reserve used principal and floor division. The vault and the credit line count owed nav, and `MandateLogic` rounds the reserve up. A fee could sit outside the cap, and a reserve of 1 covered an exposure whose ceiling requirement is 2. | Exposure is unpaid nav. `reserveNeed` is `floor((owed * bps + 9999) / 10000)`. Concentration uses `floor(assets * cap / 10000)`. |
| T-2 | Economic | The loss split treated `equity + realizedFees` as still available after interest had left the sheet. Senior was written down only for what remained after that phantom equity. | The equity room subtracts `interestExpense`. A 40,000 interest payment on 100,000 equity no longer absorbs a later loss that belongs to senior. |
| T-3 | Repay-first | `settleQueue` subtracted nav before the advance was booked. The breach counter required `blocked && paid > 0`, and investors were paid only in the `!blocked` branch, so the counter could not fire. An advanced request with no line spent the cash and then paid investors. | Cash is returned unless the advance closes. Investors are paid only when every due advance is closed. `repayFirstBroken` is that post-condition. |
| T-4 | Access | `reverts` called `simulateContract` on the wallet client, which does not implement it, and then returned true for every throw. Replay, a bad signature, and Lockgate's failed approve and withdraw were counted as reverts without a simulation. | Simulate on the public client with the caller's account. Only a contract revert counts. Any other error fails the run with `rpc`. |
| T-5 | Replay | The private Forge artifact was reused when the contract's own file was older than the artifact. An imported source could change and the runner would still deploy the old bytecode. | Rebuild when any `.sol` file under `contracts/src` or `contracts/lib` is newer than the artifact. |
| T-6 | Rounding | The proposal schema accepted a JSON number. `JSON.parse` rounds integers past 2^53, and `BigInt` then kept the rounded value. | Amounts are a bigint or a decimal string. |
| T-7 | Replay | Replay tests used one vault. A signature is an EIP-712 digest whose domain name is `LockgateAdvance`, version `1`, and whose verifying contract is that vault. | `CrossVaultReplay` expects `BadEngineSig` on the other vault, leaves its idle unchanged, and then funds nonce 1 with that vault's own signature. The end-to-end run does the same with the engine signature. |

## Reviewed, no code change

- The simulator still floors the zero-risk 600s × 4320 case to 98 bps and clamps to 25–1500. On-chain `PricingMath` half-up of that case is 99 bps and refuses a fee above the max. `sim/test/pricing.test.ts` pins the simulator figure. The two are not the same number.
- Gated quotes and a NAV age of 7 days plus one second are refused in `Stage1Failures` and in the simulator. Age equal to 7 days is still available.
- `Reenter` still expects the token callback to hit `ReentrancyGuardReentrantCall` and a short transfer to hit `FeeOnTransfer`. This pass did not change `contracts/src`.
- `PartnerKeys` still expects Lockgate's own signature, with an empty partner signature, to revert `NotApproved` and move no cash.
- The fork suite reads Arbitrum Sepolia USDG at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` and does not broadcast. Chain id 421614, 6 decimals.
- The end-to-end runner still uses the published Anvil development keys, on `127.0.0.1:8545` only. Those keys are not treated as secrets. The runner does not start, reset, or stop Anvil.

## Residual

- Utilization in the simulator is cash advanced over cash advanced plus idle. Caps use owed nav. A full book can show a utilization below the nav exposure.
- The long-horizon book still uses time scale 1. The 10-minute demo scale is a separate quote, pinned at 98 bps in the simulator.
- `solidityTreeMtime` is cached for the process. A source edited after the first deploy in that process is not rebuilt.
- A `BaseError` whose message contains "reverted" still counts as a revert, including one that is not `ContractFunctionRevertedError`.
- The same `quoteId` on two vaults is still the partner residual: `relayRepay` takes the record at the index the caller passes. This pass did not change the router.
- After the waterfall fix, `RESULTS.md` shows senior impaired on 0 of 150 paths. That is the output of these scenario sizes, not a proof that senior cannot take a loss.
