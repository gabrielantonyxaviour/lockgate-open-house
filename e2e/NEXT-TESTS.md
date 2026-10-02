# SUMMARY

Ten tests that are not in the tree, ranked by cash moved or by a solvency identity. Each target is a G9 directory: `contracts/test/invariant/`, `contracts/test/fork/`, `sim/test/`, or `e2e/test/`. Write the test. Do not patch production to make it pass. Do not run `npm run verify`, `npm run flaky`, `forge test`, `npm run compare`, or `npm run sim`.

# The ten

| # | What the cash does | Assert | File |
|---|---|---|---|
| 1 | Re-run passes: the counterexample is pinned as `test_recordedCounterexampleHolds`. As found: one verify fuzz broke the facility cash identity: `32728340926 != 32729340929` at run 6. | Replay `testFuzz_unpaidDrawBecomesDeficitAndRepayRestoresSeniorFirst` with raw args `[3, 79228162514264337593543950332, 486443499876322530418866, 59944674909726747, 2588]`, seed `0xac60779458821b7d1e165eb2402b4ca8a239716756372c66132d9ab0b23af13e`. After the loss, cash equals the pre-loss cash. Senior deficit is restored before junior. `solvent()` stays true. | New `contracts/test/invariant/LossReplay.t.sol`. Leave `contracts/test/facility/LossSymmetry.t.sol` and `FacilityMath` untouched. |
| 2 | FIXED 2026-10-02 (router approval, `RouterGrief.t.sol`). As found: index 0 of one `quoteId` pays grief `100000000` and leaves honest outstanding principal `990000000`. The platform ends at `989000000`. | Mint the honest advance's `owedOf` onto the platform, then `relayRepay(quoteId, 1)`. Honest principal becomes 0. Grief stays 0. Router and Lockgate stay 0. Read `owedOf` in the test. Do not hard-code a second repay amount. | Add `test_indexOneRepaysTheHonestVault` to `contracts/test/invariant/Adversarial.t.sol` (166 lines). Keep that file under 300 lines. |
| 3 | Pause blocks `draw`. `markLate` has no `whenNotPaused`, so a pause does not freeze a slash. | Draw, post a reserve, pause, warp to `dueAt + grace`, call `markLate`. Slashed reserve equals `min(reserve, remaining)`. The unpaid remainder moves to `lateOutstanding`. `draw` still reverts `EnforcedPause`. Lockgate's balance stays 0. | New `contracts/test/invariant/PausedLate.t.sol`. Leave `contracts/test/core/CreditLine.t.sol` and `Stage3Edges.t.sol` untouched. |
| 4 | `autoModule` may `execute` with an empty partner signature. Bounds live only inside `AutoApproveModule`. | Store a different contract as `autoModule`. Its `execute` with `""` funds a proposal the real module would refuse, and the mandate still reverts a bad platform, a low fee, and a cash shortfall. A stranger with `""` reverts. Lockgate's balance stays 0. | New `contracts/test/invariant/ModuleSwap.t.sol`. Leave `contracts/test/partner/Security.t.sol` untouched. |
| 5 | A valid engine signature can be filed, then the idle can leave before `execute`. | Sign a proposal that `preview` accepts. Withdraw idle under the payout. `execute` reverts `MandateRejected` for cash. Idle left and the advance count stay put. Lockgate's balance stays 0. | New `contracts/test/invariant/SnapshotRecheck.t.sol`. The engine `--rpc` compare is already `engine/test/vaultread.test.ts`. Do not add an engine test. |
| 6 | A new facility book waits two days. The live book can lower `eligibleOutstanding`, and `recognizeLoss` uses that number. | `scheduleBook` a second book. Before `executeBook`, lower the live book's eligible. `recognizeLoss` books the draw above that live eligible. `executeBook` is still `TooEarly`. Cash stays in the facility. `solvent()` stays true. | New `contracts/test/invariant/BookWait.t.sol`. |
| 7 | Interest can accrue without a token mint. The zero-APR conservation run does not warp. | Same identities as `invariant_fundsAreConserved`, with a non-zero facility APR, a warp, and `poke`. Supply still equals tracked balances. Stage-1 assets equal equity. Vault balance equals idle plus reserve. Facility balance equals cash. Lockgate stays 0. `solvent()` stays true. | New `contracts/test/invariant/AccrualConservation.t.sol` and its own handler. Leave `FlowConservation.t.sol` and `FlowHandler.sol` as the zero-APR, no-warp case. |
| 8 | The Sepolia facility fork draws against `MockBook` and an oracle at `address(0)`. | New fork. Token is `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` on chain 421614. The book is a credit line deployed on the fork. Draw and repay stay inside the facility. Supply is unchanged. Lockgate stays 0. No broadcast. | New `contracts/test/fork/SepoliaCreditBook.t.sol`. Leave `SepoliaFacility.t.sol` in place. Deploy a local mock peg on the fork, or leave the peg off and say so in the test. Do not invent a feed address. |
| 9 | `absorbLoss` can write senior down. No `runOnce` scenario does. The 150-path book reports senior loss 0. | One stage-3 `runOnce` with a thin reserve and a default large enough that reserve, junior, and equity are 0 and `seniorLoss > 0`. Coverage uses reserve absorbed over that credit loss. | New `sim/test/senior.test.ts`. Do not add the case to `scenarioSet()`. Do not run `npm run sim`. |
| 10 | `submitProposal` stores the digest before `preview`. A mandate rejection occupies the nonce. | File an engine-signed proposal that `preview` rejects. A second submit of that nonce reverts `NonceUsed`. `approve` does not fund it. `cancel` burns the nonce. Idle is unchanged. A later nonce still funds. | New `contracts/test/invariant/StuckNonce.t.sol`. |

# Already pinned

Leave these out of the next ten. A new file would repeat a passing test.

| Behaviour | Where it already lives |
|---|---|
| Index 0 grief repay, second index-0 call reverts `Empty` | `Adversarial.t.sol`, `sim/src/library.ts` |
| USDC print `98999999` on seed `20261001`: stage 3 still advances `3226` with `293` peg refusals; default coverage stays `2287` | `sim/test/oracle.test.ts` |
| 365 daily floors versus one facility year, gap `105` | `sim/test/bounds.test.ts`, `FacilityTime.t.sol` |
| Utilization `5000` against exposure `10000` | `sim/test/utilization.test.ts` |
| Same-day gates for `p00`, `p18`, `p30` | `sim/test/concurrent.test.ts` |
| Facility warp up to 10 days at senior APR `500` and junior APR `800`, with `solvent()` and cash equal to the token balance | `contracts/test/facility/FacilityInvariant.t.sol` |
| Pause blocks draw and still allows repay | `CreditLine.t.sol` `test_pauseBlocksDrawNotRepay` |
| Warp during pause does not slash unless `markLate` is called | `Stage3Edges.t.sol` `test_pauseAndResumeLeaveTheOpenBook` |
| Book swap is timelocked two days | `FacilityCovenants.t.sol` `test_bookChangeIsTimelocked` |
| One reverting or gas-heavy vault does not blank `quote` | `contracts/test/partner/Security.t.sol` `test_oneBadVaultDoesNotBlankTheQuote` |
| Real `AutoApproveModule` bounds | `Guard.t.sol`, `Failures.t.sol` |
| Reserve withdrawal while exposure is open | `Mandate.t.sol` |
| Door 2 sell and settle | Removed: not deployed, superseded. `DoorTwo.t.sol` is a unit test of the unused sources. |

# How to run one new file

From `lockgate/repo/contracts` for a Foundry file. From `lockgate/repo/sim` or `lockgate/repo/e2e` for a Node file. `npm test` in `e2e` stays offline. A fork test reads `https://sepolia-rollup.arbitrum.io/rpc` and does not broadcast. Do not start, reset, warp, or stop the shared Anvil on `127.0.0.1:8545`.
