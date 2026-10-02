# Security notes — testing

## SUMMARY

Reviewed the simulator, the local end-to-end runner, and the invariant and fork suites on 2026-10-02. The pass covered access control, reentrancy, rounding, oracle staleness, signature replay, denial of service, griefing, and economic attacks. Eight findings were fixed under `sim/`, `e2e/`, and `contracts/test/invariant/CrossVaultReplay.t.sol`. Regressions are in `sim/test/books.test.ts`, `sim/test/failures.test.ts`, `sim/test/queue.test.ts`, `e2e/test/security.test.ts`, and that Foundry file. The stage-2 runner also rejects a signature copied onto the other partner vault. A later actor pass reproduced one partner-router break. The report is `contracts/test/partner/G9-ADVERSARIAL.md`. The stage 1–3 map is `sim/COVERAGE.md`. The handoff is `e2e/HANDOFF.md`. Partner source was not edited. This is not a pentest and not a legal opinion. No contract source was changed.

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
| T-8 | Economic | Stage-2 concentration used `balance + principal`. Posted reserve sits in `balance`, so the cap was larger than `PartnerVault.totalAssets`, which is idle cash plus outstanding principal. | `mandateAssets` is `balance - reserve + principal`. An owed amount above that floored cap is `mandate-concentration`. Equality with the cap still passes. |

## Reviewed, no code change

- The simulator still floors the zero-risk 600s × 4320 case to 98 bps and clamps to 25–1500. On-chain `PricingMath` half-up of that case is 99 bps and refuses a fee above the max. `sim/test/pricing.test.ts` pins the simulator figure. The engine quote on that clock is 101 bps. `npm run compare` funds that signed fee on Anvil and writes `e2e/DIVERGENCE.md`. The three are not the same number.
- Gated quotes and a NAV age of 7 days plus one second are refused in `Stage1Failures` and in the simulator. Age equal to 7 days is still available.
- `Reenter` still expects the token callback to hit `ReentrancyGuardReentrantCall` and a short transfer to hit `FeeOnTransfer`. `Stage2Reenter` and `Stage3Reenter` expect the same selector on a partner execute, a partner withdrawal, and a facility draw. Each pays once. This pass did not change `contracts/src`.
- `PartnerKeys` still expects Lockgate's own signature, with an empty partner signature, to revert `NotApproved` and move no cash.
- The fork suite reads Arbitrum Sepolia USDG at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` ([Arbiscan](https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892)) and does not broadcast. `SepoliaExit` draws and repays one advance on a local fork of that token. Chain id 421614. A 600-second quote is 99 bps. `SepoliaPartner` repays one partner vault on that token. Lockgate's withdrawal reverts, and Lockgate's balance stays 0. `SepoliaFacility` draws and repays 40e6 of a 100e6 senior deposit. A stranger cannot draw. The fork directory passed 9 tests.
- The end-to-end runner still uses the published Anvil development keys, on `127.0.0.1:8545` only. Those keys are not treated as secrets. The runner does not start, reset, or stop Anvil.

## Residual

- Utilization in the simulator is cash advanced over cash advanced plus idle. Caps use owed nav. `sim/test/utilization.test.ts` draws principal 100000e6 against owed nav 150000e6, leaves 100000e6 idle, and expects utilization 5000 and exposure 10000. One more unit of owed nav is `over-limit`. The principal is still under the cap.
- The long-horizon book still uses time scale 1. The 10-minute demo scale is a separate quote, pinned at 98 bps in the simulator.
- `solidityTreeMtime` is cached for the process. A source edited after the first deploy in that process is not rebuilt.
- A `BaseError` whose message contains "reverted" still counts as a revert, including one that is not `ContractFunctionRevertedError`.
- The same `quoteId` on two vaults is still the partner residual: `relayRepay` takes the record at the index the caller passes. Reproduced in `sim/src/actors.ts` (`front-run-repay`) and `contracts/test/invariant/Adversarial.t.sol` (`test_frontRunRecordLeavesTheHonestVaultOpen`, gas 1323060). Grief is repaid 100_000_000. Honest outstanding principal stays 990_000_000. The platform ends at 989_000_000. The router and Lockgate stay at 0. A second call of that index reverts `Empty`. The report for the partner owner is `contracts/test/partner/G9-ADVERSARIAL.md`. Shared idle and mandate abuse held. This pass did not change the router.
- After the waterfall fix, `RESULTS.md` shows senior impaired on 0 of 150 paths. That is the output of these scenario sizes, not a proof that senior cannot take a loss.
