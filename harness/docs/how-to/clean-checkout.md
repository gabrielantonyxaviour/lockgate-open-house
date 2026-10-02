# Rehearse the harness from a clean tree

> Record note: this record predates the 2026-10-02 fixes. Door 2 is no longer deployed (16 contracts), platform creation is Lockgate-only, and router listing needs Lockgate approval.

Install, build, deploy, and run every harness action from a tree that has no generated state. On 2 Oct 2026 that rehearsal exited 0 on Node v24.14.0. No command needed a leftover `node_modules`, `out`, `cache`, `broadcast`, `deployments`, or `.anvil.pid`, so the harness source stayed as it was.

Leave port 8545 alone. Quote `fee` and `feeBps`, `received`, `juniorAfter`, unix timestamps, `capital`, `outstanding`, `earnedFees`, balances, and `lockgateEth` move with the clock. The figures below are this run. The stable command list and the earlier pass live in [run-on-anvil.md](run-on-anvil.md).

## Copy the source

From `lockgate/repo`, copy the working tree and leave generated state behind. This run wrote the copy outside the repo, so the shared Anvil and the repo's `harness/deployments` stayed in place. `contracts/lib` stayed in the copy.

```bash
rsync -a \
  --exclude node_modules \
  --exclude out \
  --exclude cache \
  --exclude broadcast \
  --exclude deployments \
  --exclude .anvil.pid \
  --exclude .git \
  --exclude '*.tsbuildinfo' \
  ./ /tmp/lockgate-clean-rehearsal/
```

A fresh git checkout already lacks those generated paths. Run the rest of this page from the copy's `harness` directory.

## Install and build

`npm ci` is the install. `package-lock.json` is already in the tree.

```bash
npm ci
forge build --skip test --root ../contracts
forge build --root fixture
```

`npm ci` printed:

```text
added 21 packages, and audited 22 packages in 3s
found 0 vulnerabilities
```

There is no `npm run build`. `npm test` runs the same two forge commands as `pretest`. Run them before `preflight`. A checkout that only installs still has no artifacts, and `preflight` then exits `NOT_BUILT`.

The contract build printed:

```text
Compiling 121 files with Solc 0.8.28
Solc 0.8.28 finished in 15.99s
Compiler run successful!
```

The fixture build printed:

```text
Compiling 20 files with Solc 0.8.24
Solc 0.8.24 finished in 3.25s
Compiler run successful!
```

Forge also printed existing lint warnings (`block-timestamp`, `unsafe-typecast`, `erc20-unchecked-transfer`). Both builds exited 0.

## Start Anvil

Pick a free loopback port other than 8545. This run used 18546 for the click-through, 18547 for the demos, and 18548 for the readiness check. Unset, `npm run anvil` uses 8546.

```bash
HARNESS_ANVIL_PORT=18546 npm run anvil
```

The command printed `{"pid":49712,"rpc":"http://127.0.0.1:18546"}` and returned. Anvil is detached. Stop that pid when you finish.

`npm run anvil` does not wait until the RPC answers. On this machine `npm run preflight` was started as soon as that command returned, five times, on port 18548. Each preflight exited 0. The five runs took 524 ms, 467 ms, 468 ms, 460 ms, and 454 ms.

## Preflight, deploy, and compare bytecode

```bash
HARNESS_RPC=http://127.0.0.1:18546 npm run preflight
HARNESS_RPC=http://127.0.0.1:18546 npm run deploy:local
HARNESS_RPC=http://127.0.0.1:18546 npm run bytecode
```

Preflight printed:

```json
{"ok":true,"target":"local","chainId":31337,"deployer":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","balance":"10000000000000000000000","minBalance":"1000000000000000","artifactCount":17}
```

`deploy:local` printed `mode` `protocol`, `chainId` `31337`, factory `0x5FbDB2315678afecb367f032d93F642f64180aa3`, and these 18 contracts: `Create2Factory`, `MockUSDG`, `UsdgAdapter`, `PricingEngine`, `PlatformReserve`, `LockgateCreditLine`, `Router`, `PartnerVaultImpl`, `CreditLineBook`, `CreditFacility`, `PartnerVaultA`, `PartnerVaultB`, `WeeklyImpl`, `EpochImpl`, `QuarterImpl`, `FundFactory`, `OpenCreditVault`, `LockgateExitPool`. `PartnerVaultA` was `0x60baCFce9e3b57D8aA4439F1e37eF8B69f47565C`.

Bytecode printed:

```json
{"ok":true,"chainId":31337,"compared":18,"matched":18}
```

The first `read.status` printed `capital` `0`, `outstanding` `0`, `utilizationBps` `0`, `earnedFees` `0`, `paused` `false`, `weeklyReserve` `null`, `weeklyNextWindow` `null`, `vaultAIdle` `0`, `vaultBIdle` `0`, `facilityDrawn` `0`, `facilityRecovery` `false`, `borrowingBase` `0`, and `lockgateEth` `9999.958748062349873717`. Seed balances were `lockgate` `200000`, `platform` `40000`, `partnerA` `80000`, `partnerB` `50000`, `senior` `100000`, `junior` `20000`, `investor` `20000`, `governor` `0`.

## Run every click-through action

Export `HARNESS_RPC=http://127.0.0.1:18546`. Run `help`, then the click-through commands in [run-on-anvil.md](run-on-anvil.md), in that order. Pass the `exitRef` from `stage2.routedAdvance` to `stage2.repay`. `help` printed 40 action lines. Every later command exited 0. The JSON also contains a transaction `hash`. This page leaves hashes and `exitRef` out.

This run's clock fields were:

| Field | Value |
|---|---|
| `stage1.quote` `feeBps`, `fee` | `98`, `9800000` |
| `stage1.processWindow` `nextWindow` | `1790902185` |
| `stage1.exitNow` `received` | `101337068` |
| `stage1.repay` processed `nextWindow` | `1790902785` |
| `stage1.draw` `received` | `5066853400` |
| `stage2.setMandate` `expiry` | `1793494487` |
| `stage2.proposeUpgrade` `eta` | `1791161987` |
| `stage1.markLate` `remaining`, `principal` | `3117000000`, `5066853400` |
| `stage3.recognizeLoss` `juniorPrincipal`, `seniorInterestDue` | `2019999995`, `435399` |

`stage1.draw` also printed `requestId` `3`, `advanceId` `2`, and `nav` `5117000000`. `recognizeLoss` printed `books.drawn` `0`, `books.seniorPrincipal` `10000000000`, and `books.recovery` `true`. The preview slice `vault` was `PartnerVaultA` at `0x60baCFce9e3b57D8aA4439F1e37eF8B69f47565C`. The other id, amount, and address fields matched the prints column in [run-on-anvil.md](run-on-anvil.md).

After `stage1.registerPlatform`, the manifest had 19 contracts, including `WeeklyQueuePlatform` at `0x8464135c8f25da09e49bc8782676a84730c318bc`. A second bytecode command printed `compared` `19` and `matched` `19`.

The closing `read.status` printed:

```json
{
  "capital": "96939.049532",
  "outstanding": "3066.8534",
  "utilizationBps": 306,
  "earnedFees": "5.902932",
  "paused": false,
  "weeklyReserve": "0",
  "weeklyNextWindow": "1790902785",
  "vaultAIdle": "19603.5",
  "vaultAOwner": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "vaultBIdle": "0",
  "facilityDrawn": "0",
  "facilityRecovery": true,
  "borrowingBase": "0",
  "lockgateEth": "9999.957176280155307782"
}
```

Closing balances were `lockgate` `101980`, `platform` `38093.16`, `partnerA` `59800`, `partnerB` `50000`, `senior` `90000.000005`, `junior` `16000`, `investor` `20126.230468`, `governor` `0`.

## Run the four demo actions

The click-through consumes the first chain. Start a second Anvil and deploy into a separate manifest.

```bash
HARNESS_ANVIL_PORT=18547 npm run anvil
HARNESS_RPC=http://127.0.0.1:18547 HARNESS_MANIFEST=deployments/demo.json npm run deploy:local
HARNESS_RPC=http://127.0.0.1:18547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.stage1
HARNESS_RPC=http://127.0.0.1:18547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.stage2
HARNESS_RPC=http://127.0.0.1:18547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.stage3
HARNESS_RPC=http://127.0.0.1:18547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.all
HARNESS_RPC=http://127.0.0.1:18547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.all
```

Wait until the second node answers `eth_chainId` `0x7a69` before `deploy:local`. This deploy printed the same `mode`, chain, factory, and 18 contracts as the first deploy. Each demo command exited 0.

`demo.stage1` printed `lateAdvance` `2` and `shortfall` `3117000000`. `demo.stage2` printed `funded` `PartnerVaultA`, `roundRobin` `["PartnerVaultB","PartnerVaultA"]`, and `blocked.lockgateCanMoveFunds` `false`. The owner was `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`. `demo.stage3` printed `base` `4093600000` and `juniorAfter` `2009552507`.

`demo.all` runs after stage 3 is already in recovery, so its `stage3.base` is the borrowing base, `0`, and `juniorAfter` stays `2009552507`. Door 2 printed `positionId` `1`, `nav` `1000000000`, `fee` `4900000`, and `feeBps` `49`. The two `demo.all` outputs were equal. Each `npm run` stdout was 525 bytes. The JSON body, without the npm script header, was:

```json
{
  "stage1": {
    "lateAdvance": "2",
    "shortfall": "3117000000"
  },
  "door2": {
    "positionId": "1",
    "nav": "1000000000",
    "fee": "4900000",
    "feeBps": 49
  },
  "stage2": {
    "blocked": {
      "owner": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "lockgateCanMoveFunds": false
    },
    "funded": "PartnerVaultA",
    "roundRobin": [
      "PartnerVaultB",
      "PartnerVaultA"
    ]
  },
  "stage3": {
    "base": "0",
    "juniorAfter": "2009552507"
  }
}
```

## Next

Stop the pid from each `npm run anvil`. The console, the role table, and the Sepolia dry run are in [run-on-anvil.md](run-on-anvil.md). The offline fork stand-ins are in [sepolia-fork-offline.md](sepolia-fork-offline.md).
