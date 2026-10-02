# Check the harness against the current working tree

> Record note: this record predates the 2026-10-02 fixes. Door 2 is no longer deployed (16 contracts), platform creation is Lockgate-only, and router listing needs Lockgate approval.

Rebuild the dirty tree, deploy it on a private Anvil, and run every harness action. On 2 Oct 2026 that check exited 0 on Forge 1.7.1 and Node v24.14.0. The git tip was `9665484`. The sources under test were the uncommitted working tree. The suite then passed 98 and failed 0 in 55455.614 ms.

Leave port 8545 alone. Leave `harness/deployments` alone. Quote `fee`, `received`, `juniorAfter`, unix timestamps, `capital`, `outstanding`, balances, and `lockgateEth` move with the clock. The figures below are this run. Earlier passes stay in [run-on-anvil.md](run-on-anvil.md), [clean-checkout.md](clean-checkout.md), [g6-g7-g8.md](g6-g7-g8.md), and [sepolia-fork-offline.md](sepolia-fork-offline.md).

## Rebuild

From `lockgate/repo/harness`. These commands write artifacts to `contracts/out` and `harness/fixture/out`. The cache paths stay outside the repo. Do not `forge clean`.

```bash
mkdir -p /tmp/lockgate-final-tree/contracts-cache /tmp/lockgate-final-tree/fixture-cache
forge build --skip test --root ../contracts --cache-path /tmp/lockgate-final-tree/contracts-cache
forge build --root fixture --cache-path /tmp/lockgate-final-tree/fixture-cache
```

The contract build printed `Compiling 122 files with Solc 0.8.28`, `Solc 0.8.28 finished in 16.13s`, and `Compiler run successful!`. The fixture build printed `Compiling 20 files with Solc 0.8.24`, `Solc 0.8.24 finished in 3.33s`, and `Compiler run successful!`. Forge also printed the existing lint warnings (`block-timestamp`, `unsafe-typecast`, `erc20-unchecked-transfer`). Both builds exited 0.

## Deploy on a private Anvil

This run started Anvil with `--host 127.0.0.1`, `--chain-id 31337`, and `--silent`, on a free port other than 8545. It did not write `harness/.anvil.pid`. The click-through used port 57102. The demos used 57465. The receipt deploy used 57648. Manifests stayed under `/tmp/lockgate-final-tree/deployments`.

Wait until `eth_chainId` is `0x7a69` before `preflight`. Preflight printed `ok` `true`, `target` `local`, `chainId` `31337`, deployer `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, `balance` `10000000000000000000000`, `minBalance` `1000000000000000`, and `artifactCount` `17`.

`deploy:local` printed `mode` `protocol`, `chainId` `31337`, factory `0x5FbDB2315678afecb367f032d93F642f64180aa3`, and 18 contracts. Bytecode printed `compared` `18` and `matched` `18`. The second Anvil printed the same 18 addresses.

The factory is still the nonce-0 CREATE. `WeeklyQueuePlatform` is not in this set. It is the platform account's nonce-0 CREATE, so its address stayed `0x8464135c8f25da09e49bc8782676a84730c318bc`. `PricingEngine`, `Router`, and `PartnerVaultImpl` also stayed at the addresses in [g6-g7-g8.md](g6-g7-g8.md). The other CREATE2 addresses moved, because the init code changed.

| Contract | Address |
|---|---|
| `MockUSDG` | `0xd3D3B2845090A02Ed08C35B7F4a170d50d397089` |
| `UsdgAdapter` | `0x7318694dbA162f430E292e00A0Df1adEebc11524` |
| `PricingEngine` | `0x4EC26E05fFD21f42aCE24af32E1C81764DCa6269` |
| `PlatformReserve` | `0x7006357DE8f0C51B33bAfAB15E2250Ec7Be5F92F` |
| `LockgateCreditLine` | `0x61cF981a2c46bab2934540cacD4550A1FE8ca675` |
| `Router` | `0x1891299431dA24A85B743679300460D3e90d760a` |
| `PartnerVaultImpl` | `0x9EA79CdE1836599669a3A4C74C00C7F2fEF5F56b` |
| `CreditLineBook` | `0x60C5d960c3e62794640A9E8b06695dCeE993Ca97` |
| `CreditFacility` | `0xdA726C12dA3F13213C679c80180e1375788Cd700` |
| `PartnerVaultA` | `0x2203363a12997c66584DEc0891b3C6A90eA05254` |
| `PartnerVaultB` | `0x088001C5Ff6ed230e17268dF017D3d4b6fA15C0a` |
| `WeeklyImpl` | `0x958D2b8Fee8A951B58a2Bb971fA26dEC9A78faD6` |
| `EpochImpl` | `0x01Af4160bC384e0fd0c0e0165b4a9A15E8DE38F7` |
| `QuarterImpl` | `0x6288F209910aA6b57e701A8C9B9e8d38C5E9E412` |
| `FundFactory` | `0x6699922CAd5feE2E0191b9363973c827b4D782aC` |
| `OpenCreditVault` | `0x2Df518611816322F6d9d3DDDDD4D10ecfB08e8F2` |
| `LockgateExitPool` | `0x578DFC86F8Fb0e172b0ae0f561568d419E1e1264` |

`harness/deployments/31337.json` was not rewritten. It still has `rpc` `http://127.0.0.1:8546`, 19 contracts, `MockUSDG` `0xe32E788308cCDA7e20A67Dd288416D9Dff69410d`, and `PartnerVaultA` `0x1CC98fCeb89B29C1Fb06A3Af3b65b3E7282556D5`. Its size stayed 2082 bytes and its mtime stayed 1790897674. Deploy again before you trust that file against this build.

## Console, click-through, and demos

The console bound `127.0.0.1` on a free port. The page title was `Lockgate test console`, and the page says it is not the product and not an offer. `GET /api/surface` returned `mode` `protocol` and 40 actions. `GET /api/status` and `POST /api/act` for `read.status` returned chain `31337`. The POST returned `"ok":true`. No browser opened the page.

`help` printed 40 action lines. `stage2.repay` has `--exitRef` and no default. Every command in [run-on-anvil.md](run-on-anvil.md) then exited 0. This page leaves hashes and `exitRef` out.

The first `read.status` printed `capital` `0`, `outstanding` `0`, `utilizationBps` `0`, `earnedFees` `0`, `paused` `false`, `weeklyReserve` `null`, `weeklyNextWindow` `null`, `vaultAIdle` `0`, `vaultBIdle` `0`, `facilityDrawn` `0`, `facilityRecovery` `false`, `borrowingBase` `0`, and `lockgateEth` `9999.958722262214790438`. Seed balances were `lockgate` `200000`, `platform` `40000`, `partnerA` `80000`, `partnerB` `50000`, `senior` `100000`, `junior` `20000`, `investor` `20000`, `governor` `0`. `timing.gasUsed` was `0` and `elapsedMs` was `16`.

| Field | Value |
|---|---|
| `stage1.quote` `feeBps`, `fee` | `98`, `9800000` |
| `stage1.processWindow` `nextWindow` | `1790907547` |
| `stage1.exitNow` `received` | `101337068` |
| `stage1.repay` processed `nextWindow` | `1790908147` |
| `stage1.draw` `received` | `5066853400` |
| `stage2.setMandate` `expiry` | `1793499849` |
| `stage2.proposeUpgrade` `eta` | `1791167350` |
| `stage1.markLate` `remaining`, `principal` | `3117000000`, `5066853400` |
| `stage3.recognizeLoss` `juniorPrincipal`, `seniorInterestDue` | `2019999995`, `435414` |

`stage1.draw` also printed `requestId` `3`, `advanceId` `2`, and `nav` `5117000000`. That `received` value is the full weekly window on this clock. The quote above was taken before the window rolled, so it stayed at 98 bps. `recognizeLoss` printed `books.drawn` `0`, `books.seniorPrincipal` `10000000000`, and `books.recovery` `true`. The preview slice was `PartnerVaultA` at `0x2203363a12997c66584DEc0891b3C6A90eA05254`, with `feeBps` `25` and `fee` `2500000`. `stage2.setPolicy` printed `stored` `false` and `strategy` `0`. After `stage1.registerPlatform`, bytecode printed `compared` `19` and `matched` `19`.

The closing `read.status` printed `capital` `96939.049532`, `outstanding` `3066.8534`, `utilizationBps` `306`, `earnedFees` `5.902932`, `paused` `false`, `weeklyReserve` `0`, `weeklyNextWindow` `1790908147`, `vaultAIdle` `19603.5`, `vaultAOwner` `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`, `vaultBIdle` `0`, `facilityDrawn` `0`, `facilityRecovery` `true`, `borrowingBase` `0`, and `lockgateEth` `9999.957150248032146`. Its `gasUsed` was `0` and `elapsedMs` was `19`. Closing balances were `lockgate` `101980`, `platform` `38093.16`, `partnerA` `59800`, `partnerB` `50000`, `senior` `90000.000005`, `junior` `16000`, `investor` `20126.230468`, `governor` `0`.

`timing.gasUsed` for the other click-through actions was: `token.faucet` `34903`, `stage2.assertNoLockgateControl` `0`, `stage1.registerPlatform` `4484705`, `stage1.depositCapital` `131318`, `stage1.postReserve` `169213`, `stage1.quote` `0`, `stage1.setGated` `29824` then `29812`, `stage1.pause` `27995` then `27569`, `stage1.buyShares` `189486`, `stage1.requestRedeem` `334458`, `stage1.depositCash` `91607`, `stage1.processWindow` `105213`, `stage1.exitNow` `669327`, `stage1.repay` `259878`, `stage1.draw` `635139`, `door2.cycle` `1323686`, `stage2.setMandate` `76960`, `stage2.approvePlatform` `326184`, `stage2.deposit` `186103`, `stage2.postReserve` `146623`, `stage2.enlist` `101567`, `stage2.setPolicy` `0`, `stage2.preview` `0`, `stage2.routedAdvance` `717216`, `stage2.repay` `194844`, `stage2.payInvestor` `34192`, `stage2.approve` `703657`, `stage3.depositSenior` `309474`, `stage3.depositJunior` `253091`, `stage3.draw` `128131`, `stage3.repay` `177512`, `stage3.waterfall` `219560`, `stage1.markLate` `128829`, `stage2.proposeUpgrade` `37872`, `stage3.recognizeLoss` `193849`.

The signed proposal still matches `AdvanceProposalLib`, `IAdvanceProposal`, and `engine/src/proposal/typed.ts`: domain `LockgateAdvance`, version `1`, verifying contract the vault. `stage2.routedAdvance` and `stage2.approve` both exited 0. `stage2.approve` also returns `submitted`, the `submitProposal` transaction hash.

On the second Anvil, `demo.stage1` printed `lateAdvance` `2` and `shortfall` `3117000000`, with `gasUsed` `7519749` and `elapsedMs` `96`. `demo.stage2` printed `funded` `PartnerVaultA`, `roundRobin` `["PartnerVaultB","PartnerVaultA"]`, and `blocked.lockgateCanMoveFunds` `false`. The owner was `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`. `gasUsed` was `4870414` and `elapsedMs` was `127`. `demo.stage3` printed `base` `4093600000` and `juniorAfter` `2009552512`. `gasUsed` was `3604795` and `elapsedMs` was `105`.

`demo.all` runs after stage 3 is already in recovery, so its `stage3.base` is `0` and `juniorAfter` stays `2009552512`. Door 2 printed `positionId` `1`, `nav` `1000000000`, `fee` `4900000`, and `feeBps` `49`. The first `demo.all` had `gasUsed` `1340786` and `elapsedMs` `71`. The second call resumed a finished cursor, so `gasUsed` was `0` and `elapsedMs` was `11`. The stage fields matched. Stdout was 556 bytes, then 550.

## Dry run, receipt, and checksum

The same four public Anvil roles, with `LOCKGATE_ALLOW_SEPOLIA_DEPLOY` unset, make `npm run manifest` print a dry run: `mode` `dry-run`, `target` `sepolia`, `chainId` `421614`, `asset` `mock`, factory `0x5FbDB2315678afecb367f032d93F642f64180aa3`, 18 steps, every `txHash` and `blockNumber` null. `MockUSDG` is `0xd3D3B2845090A02Ed08C35B7F4a170d50d397089`. `PartnerVaultA` is `0x2203363a12997c66584DEc0891b3C6A90eA05254`. The command does not dial.

`USE_PAXOS_USDG=1` prints `asset` `paxos`, 18 steps, null receipts, and `MockUSDG` `external` at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`. `FACTORY_NONCE=no` exits 1 with `VALIDATION` and `FACTORY_NONCE must be an integer`. `npm run manifest:local` on port 57648, with `HARNESS_DEPLOYMENT` outside the repo, printed `mode` `executed`, `chainId` `31337`, the same factory, and `steps` `18`.

`npm run manifest -- broadcast`, `npm run preflight:sepolia`, and `npm run deploy:sepolia` exited 1. `npm run manifest -- broadcast` printed `SEPOLIA_BLOCKED` and `Sepolia broadcast stays a dry run. briefs/grok/G10-harness-deploy.md does not approve a funded deploy`. The other two printed `SEPOLIA_BLOCKED` and `Sepolia broadcast is blocked until LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1`. None of them dialed.

`npm run checksum` and `npm run checksum:verify`, with `HARNESS_CHECKSUM` outside the repo, both exited 0. The seal covered 126 files and used `sha256`. `harness/checksums/artifacts.json` was not written.

The logs and temp files from this pass contained one 32-byte value outside the public reference fields: `submitted` on `stage2.approve`. That value is a transaction hash. The scanner now keeps `submitted` with the other transaction hashes, and `test/writes.test.ts` plants that field. A private key in any other field still fails the suite.

## Known gaps

This pass did not close these limits.

- Public Sepolia was not broadcast. `npm run manifest -- broadcast`, `npm run preflight:sepolia`, and `npm run deploy:sepolia` exited 1 with `SEPOLIA_BLOCKED`.
- Arbitrum One was not used. Chain 42161 stays refused.
- The console was checked over HTTP. No browser rendered the page.
- `CreditFacility` is constructed with the zero address as its oracle, so this deploy does not check the peg.
- `npm run bytecode` ignores compiler immutable spans. A difference only in those spans still matches. This fresh manifest matched 18 of 18, and 19 of 19 after `stage1.registerPlatform`.
- The 5000-share `received` value follows the seconds left in the weekly window. This pass printed `5066853400`. The pass in [g6-g7-g8.md](g6-g7-g8.md) printed `5066341700`.
- `demo.stage3` `juniorAfter` was `2009552512`. Earlier pages record `2009552507` and `2009552502`. `seniorInterestDue` was `435414`.
- `forge test` and the engine suite were not re-run. The last recorded results remain 181 passed and 65 passed.
- `npx tsc --noEmit` still exits 2. The only error is `test/owners.test.ts(42,7) TS2322`. This pass did not change that test.
- The repo has no git remote, so GitHub Actions has not run. [U] until a remote exists and a run is green.
- The harness secret scan skips `lib`. Vendored `contracts/lib/forge-std` still contains Foundry's published default Sepolia RPC, the same URL as upstream `StdChains.sol` (https://github.com/foundry-rs/forge-std/blob/master/src/StdChains.sol). The suite's repo scan reported no private key and no RPC token in first-party files.
- `npm run cleanup` was not pointed at `harness/deployments`. That command deletes the saved chain 31337 files after a successful reset. The suite covers cleanup on a private directory.
- Restarting Anvil was not repeated outside the suite. The suite includes that test. This run of it took 807.109084 ms. The saved deployments were left as they were.

## Next

Stop any Anvil this page started. The shared Anvil on 8545 stays up. The click-through command list is in [run-on-anvil.md](run-on-anvil.md). The earlier contract check is in [g6-g7-g8.md](g6-g7-g8.md).
