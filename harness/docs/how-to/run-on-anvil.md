# Run the harness on Anvil

Deploy the Lockgate contracts on a private Anvil, then click through stage 1, door 2, stage 2, and stage 3. You check each command by the JSON fields below.

Run the commands from `lockgate/repo/harness`. Port 8545 belongs to the shared node. This page uses 8546, 8547, and 8548.

Action JSON amounts are raw token units. USDG has 6 decimals, so 1000 USDG is `1000000000`. Share counts use 18 decimals. `read.status` prints USDG as a decimal string. A `hash` field is a transaction hash.

## Set up

Install Foundry and Node 22 or newer. These commands were run with Foundry 1.7.1 and Node 24.14.0.

1. Install the harness packages:

   ```bash
   npm install
   ```

2. Run the suite:

   ```bash
   npm test
   ```

   The command exits 0. It builds `contracts/` and `harness/fixture`, starts an Anvil on a free loopback port other than 8545, and stops that process.

## Start Anvil and deploy

1. Start Anvil:

   ```bash
   npm run anvil
   ```

   Stdout is one JSON object with `pid` and `"rpc":"http://127.0.0.1:8546"`. The same pid is written to `.anvil.pid`. Stop that pid when you are finished. Leave the process on port 8545 running.

2. Check the node, the chain, the deployer balance, and the compiled artifacts:

   ```bash
   HARNESS_RPC=http://127.0.0.1:8546 npm run preflight
   ```

   Stdout is this object. `balance` is 10000 ETH in wei. `minBalance` is 0.001 ETH in wei.

   ```json
   {"ok":true,"target":"local","chainId":31337,"deployer":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","balance":"10000000000000000000000","minBalance":"1000000000000000","artifactCount":17}
   ```

3. Deploy:

   ```bash
   HARNESS_RPC=http://127.0.0.1:8546 npm run deploy:local
   ```

   Stdout is one JSON object. `mode` is `protocol`, `chainId` is `31337`, and `factory` is `0x5FbDB2315678afecb367f032d93F642f64180aa3`. `contracts` has these 18 names: `Create2Factory`, `CreditFacility`, `CreditLineBook`, `EpochImpl`, `FundFactory`, `LockgateCreditLine`, `LockgateExitPool`, `MockUSDG`, `OpenCreditVault`, `PartnerVaultA`, `PartnerVaultB`, `PartnerVaultImpl`, `PlatformReserve`, `PricingEngine`, `QuarterImpl`, `Router`, `UsdgAdapter`, `WeeklyImpl`.

   The file is `deployments/31337.json`. That directory is gitignored. `npm run cleanup` resets this Anvil with `anvil_reset` and removes only `31337.json`, `31337.demo.json`, `31337.deployment.json`, and an `HARNESS_MANIFEST` file inside this directory. It refuses a public host, port 8545, and a symlink before it dials.

4. Compare deployed bytecode with the current build:

   ```bash
   HARNESS_RPC=http://127.0.0.1:8546 npm run bytecode
   ```

   Stdout on this pass was `{"ok":true,"chainId":31337,"compared":18,"matched":18}`. A mismatch prints `{ "error", "code": "STALE" }` on stderr and exits 1. The message names the contract and does not print bytecode. Immutable spans are ignored. `PartnerVaultA` and `PartnerVaultB` are checked against the proxy.

## Open the console

1. Start the console:

   ```bash
   HARNESS_RPC=http://127.0.0.1:8546 npm run serve
   ```

   Stderr prints `harness http://127.0.0.1:18910`. The process keeps running.

2. Open the page and the JSON routes:

   ```bash
   curl -fsS http://127.0.0.1:18910/
   curl -fsS http://127.0.0.1:18910/api/surface
   curl -fsS http://127.0.0.1:18910/api/status
   curl -fsS -X POST http://127.0.0.1:18910/api/act \
     -H 'content-type: application/json' \
     -d '{"action":"read.status","input":{}}'
   ```

   The page title is `Lockgate test console`. The page says it is not the product and not an offer. `/api/surface` has `mode` `protocol` and 40 actions. `/api/status` has `chainId` `31337`. The POST body returns `"ok":true` and `result.chainId` `31337`.

3. Stop the console process when you move on to the click-through. The CLI talks to Anvil on its own.

## Environment variables

Set a value in the same command. Local commands on this page leave the Sepolia variables unset.

| Name | Default | Use |
|---|---|---|
| `HARNESS_RPC` | `http://127.0.0.1:8546` for deploy, preflight, and bytecode | Loopback URL with an explicit port. Port 8545 is refused. An unset CLI value keeps the URL in the manifest. |
| `HARNESS_MANIFEST` | `deployments/31337.json` | Runtime manifest path. |
| `HARNESS_PORT` | `18910` | Console port. |
| `HARNESS_ANVIL_PORT` | `8546` | Port for `npm run anvil`. Values below 1024, above 65535, and 8545 are refused. |
| `HARNESS_DEPLOYMENT` | `deployments/31337.deployment.json` | Receipt file for `manifest:local`. |
| `DEPLOYER_ADDRESS` | none | Manifest dry run. Use the Anvil deployer below. |
| `GOVERNOR_ADDRESS` | none | Manifest dry run, and optional Sepolia broadcast. |
| `PARTNER_A_ADDRESS` | none | Manifest dry run, and optional Sepolia broadcast. |
| `PARTNER_B_ADDRESS` | none | Manifest dry run, and optional Sepolia broadcast. |
| `FACTORY_NONCE` | `0` | Integer. `no` returns `VALIDATION`. |
| `USE_PAXOS_USDG` | unset | `1` selects the Paxos token on the Sepolia dry run. |
| `LOCKGATE_ALLOW_SEPOLIA_DEPLOY` | unset | The character `1` is required before a Sepolia preflight or broadcast reads an RPC. Leave it unset here. |
| `DEPLOYER_PRIVATE_KEY` | unset | 32-byte hex string for a Sepolia preflight or broadcast. Do not set it for the commands on this page. |
| `SEPOLIA_RPC` | unset | Required by `preflight:sepolia` after the allow flag. There is no public fallback. |
| `SEPOLIA_MANIFEST` | `deployments/421614.json` | Optional Sepolia manifest path. A path longer than 512 characters is `VALIDATION`. |

The Anvil addresses below are Foundry's published accounts 0, 7, 2, and 3. They are deployer, governor, partner A, and partner B. https://book.getfoundry.sh/anvil/

| Role | Address |
|---|---|
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Governor | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` |
| Partner A | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Partner B | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

## Click through

Export the RPC, then run the commands in order:

```bash
export HARNESS_RPC=http://127.0.0.1:8546
```

`stage1.quote` and `stage1.draw` follow the seconds left in the weekly window. Two straight-through runs printed quote `feeBps` `98` and `fee` `9800000`. The 5000-share `received` value was `5066853400` on one run and `5066341700` on the next. Check the ids in the table. The draw's `received` value moves with the clock.

On 2 Oct 2026 the final pass ran these commands on clean Anvils at ports 8546, 8547, and 8548. `npm test` passed 71 tests, failed 0, in 34787.267084 ms. Preflight, `deploy:local`, bytecode (`compared` 18, `matched` 18), and the console page, surface, status, and `read.status` POST passed. After `stage1.registerPlatform` bytecode matched 19 of 19. Result is `pass` when the command exited as this page describes. Every row passed. This run's quote was `feeBps` `98` and `fee` `9800000`. The 100-share `exitNow` `received` value was `101337068`. The 5000-share `received` value was `5066341700`. Initial `lockgateEth` was `9999.958811816434764791`.

The final `read.status` also printed `capital` `96939.561232`, `outstanding` `3066.3417`, `utilizationBps` `306`, and `earnedFees` `5.902932`. Those four follow the exit fee and can move with the clock.

| Command | Result | Prints |
|---|---|---|
| `npm run cli -- help` | pass | 40 action lines. `stage2.repay` has `--exitRef` and no default. |
| `npm run cli -- read.status` | pass | `mode` `protocol`, `chainId` `31337`, `capital` `0`, `outstanding` `0`, `paused` `false`, `weeklyReserve` `null`, `facilityDrawn` `0`, `facilityRecovery` `false`. `lockgateEth` is below `10000`. |
| `npm run cli -- token.faucet --role investor --amountUsdg 1000` | pass | `role` `investor`, `amount` `1000`. |
| `npm run cli -- stage2.assertNoLockgateControl` | pass | `owner` `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`, `lockgateCanMoveFunds` `false`. |
| `npm run cli -- stage1.registerPlatform --kind 1 --initialShares 0` | pass | `logical` `WeeklyQueuePlatform`, `kind` `1`, `address` `0x8464135c8f25da09e49bc8782676a84730c318bc`. |
| `npm run cli -- stage1.depositCapital --amountUsdg 100000` | pass | `amount` `100000000000`. |
| `npm run cli -- stage1.postReserve --platform WeeklyQueuePlatform --amountUsdg 2000` | pass | `amount` `2000000000`. |
| `npm run cli -- stage1.quote --navUsdg 1000 --platform WeeklyQueuePlatform` | pass | `available` `true`, `reason` `""`, `nav` `1000000000`. |
| `npm run cli -- stage1.setGated --gated true` | pass | `gated` `true`. |
| `npm run cli -- stage1.setGated --gated false` | pass | `gated` `false`. |
| `npm run cli -- stage1.pause --paused true` | pass | `paused` `true`. |
| `npm run cli -- stage1.pause --paused false` | pass | `paused` `false`. |
| `npm run cli -- stage1.buyShares --shares 6000 --platform WeeklyQueuePlatform` | pass | `shares` `6000000000000000000000`, `cost` `6140400000`. |
| `npm run cli -- stage1.requestRedeem --shares 100` | pass | `requestId` `1`, `nav` `102340000`. |
| `npm run cli -- stage1.depositCash --amountUsdg 200` | pass | `amount` `200000000`. |
| `npm run cli -- stage1.processWindow` | pass | `nextWindow`, a unix timestamp. |
| `npm run cli -- stage1.exitNow --shares 100 --platform WeeklyQueuePlatform` | pass | `requestId` `2`, `advanceId` `1`, `nav` `102340000`, `received` `101337068`. |
| `npm run cli -- stage1.repay --advanceId 1` | pass | `remaining` `0`. |
| `npm run cli -- stage1.draw --shares 5000 --platform WeeklyQueuePlatform` | pass | `requestId` `3`, `advanceId` `2`, `nav` `5117000000`. |
| `npm run cli -- door2.cycle --amountUsdg 1000` | pass | `positionId` `1`, `nav` `1000000000`, `fee` `4900000`, `feeBps` `49`. |
| `npm run cli -- stage2.setMandate --vault PartnerVaultA --minFeeBps 25` | pass | `vault` `PartnerVaultA` and an `expiry` timestamp. |
| `npm run cli -- stage2.approvePlatform --vault PartnerVaultA --limitUsdg 20000` | pass | `vault` `PartnerVaultA`, `platform` `WeeklyQueuePlatform`. |
| `npm run cli -- stage2.deposit --vault PartnerVaultA --amountUsdg 20000` | pass | `amount` `20000000000`. |
| `npm run cli -- stage2.postReserve --vault PartnerVaultA --amountUsdg 200` | pass | a transaction `hash`. |
| `npm run cli -- stage2.enlist --vault PartnerVaultA` | pass | `vault` `PartnerVaultA`. |
| `npm run cli -- stage2.setPolicy --policy 0` | pass | `stored` `false`, `strategy` `0`, and the note `PartnerRouter takes the strategy on each quote. It does not store a policy.` |
| `npm run cli -- stage2.preview --navUsdg 1000 --strategy 0` | pass | one slice, `feeBps` `25`, `fee` `2500000`, `navValue` `1000000000`. |
| `npm run cli -- stage2.routedAdvance --navUsdg 1000 --strategy 0 --nonce 1` | pass | `vault` `PartnerVaultA`, `advanceId` `1`, `nonce` `1`, `fee` `2500000`, `navValue` `1000000000`, and `exitRef`. |
| `npm run cli -- stage2.repay --exitRef EXIT_REF` | pass | `owed` `1000000000`, `vault` `PartnerVaultA`. |
| `npm run cli -- stage2.payInvestor --amountUsdg 1` | pass | `amount` `1000000`. |
| `npm run cli -- stage2.approve --navUsdg 400 --strategy 0 --nonce 4` | pass | `vault` `PartnerVaultA`, `advanceId` `2`, `nonce` `4`, `fee` `1000000`, `navValue` `400000000`. |
| `npm run cli -- stage3.depositSenior --amountUsdg 10000` | pass | `tranche` `0`, `amount` `10000000000`. |
| `npm run cli -- stage3.depositJunior --amountUsdg 4000` | pass | `tranche` `1`, `amount` `4000000000`. |
| `npm run cli -- stage3.draw --amountUsdg 2000` | pass | `amount` `2000000000`. |
| `npm run cli -- stage3.repay --amountUsdg 10` | pass | `amount` `10000000`. |
| `npm run cli -- stage3.waterfall --amountUsdg 10` | pass | `repaid.amount` `10000000`, `seniorInterestBefore` `0`, `seniorInterestAfter` `0`, `seniorGain` `5`. |
| `npm run cli -- stage1.markLate --advanceId 2` | pass | `status` `2`. |
| `npm run cli -- stage2.proposeUpgrade --vault PartnerVaultA` | pass | `eta`, a unix timestamp. |
| `npm run cli -- stage3.recognizeLoss` | pass | `books.recovery` `true`, `books.drawn` `0`, `books.seniorPrincipal` `10000000000`. |

Replace `EXIT_REF` with the `exitRef` printed by `stage2.routedAdvance`.

`stage3.waterfall` accepts `--warpDays`. A non-zero value moves the clock that many days before the repay. This order already moved the clock in `stage1.processWindow` and `door2.cycle`, and the command above omits `--warpDays`.

## Check the chain

Run:

```bash
npm run cli -- read.status
```

These fields match the click-through above:

```json
{
  "mode": "protocol",
  "chainId": 31337,
  "paused": false,
  "weeklyReserve": "0",
  "vaultAOwner": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "vaultBIdle": "0",
  "facilityDrawn": "0",
  "facilityRecovery": true,
  "borrowingBase": "0"
}
```

`capital`, `outstanding`, `utilizationBps`, `earnedFees`, and the `balances` map follow the exit fee, so those decimals move with the clock.

## Run the resumable demo

Use a second Anvil and a separate manifest. `demo.stage2` does not run door 2. `demo.all` runs stage 1, door 2, stage 2, and stage 3. A second `demo.all` on the same chain prints the same JSON as the first.

1. Start the second node and deploy:

   ```bash
   HARNESS_ANVIL_PORT=8547 npm run anvil
   HARNESS_RPC=http://127.0.0.1:8547 HARNESS_MANIFEST=deployments/demo.json npm run deploy:local
   ```

2. Run the four demo commands with that RPC and manifest:

   ```bash
   HARNESS_RPC=http://127.0.0.1:8547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.stage1
   HARNESS_RPC=http://127.0.0.1:8547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.stage2
   HARNESS_RPC=http://127.0.0.1:8547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.stage3
   HARNESS_RPC=http://127.0.0.1:8547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.all
   HARNESS_RPC=http://127.0.0.1:8547 HARNESS_MANIFEST=deployments/demo.json npm run cli -- demo.all
   ```

   `demo.stage1` prints `lateAdvance` `2`. `demo.stage2` prints `funded` `PartnerVaultA`, `roundRobin` `["PartnerVaultB","PartnerVaultA"]`, and `blocked.lockgateCanMoveFunds` `false`. `demo.stage3` prints `base` and `juniorAfter`. The two `demo.all` outputs match byte for byte. On the 2 Oct 2026 final pass, `demo.stage1`, `demo.stage2`, `demo.stage3`, and both `demo.all` commands passed. The two `demo.all` outputs matched and were 525 bytes. `demo.stage3` printed `base` `4093600000` and `juniorAfter` `2009552502`.

Stop the pid from each `npm run anvil` when you are finished.

## Keep Sepolia a dry run

Print a dry-run manifest. This command does not read a private key and does not dial an RPC.

```bash
DEPLOYER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
GOVERNOR_ADDRESS=0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 \
PARTNER_A_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
PARTNER_B_ADDRESS=0x90F79bf6EB2c4f870365E785982E1f101E93b906 \
npm run manifest
```

Stdout is one JSON object. `mode` is `dry-run`, `target` is `sepolia`, `chainId` is `421614`, `asset` is `mock`, and `steps` has 18 entries.

`USE_PAXOS_USDG=1` with the same four addresses prints `asset` `paxos`, still with 18 steps, and still does not dial.

`FACTORY_NONCE=no` with those addresses exits 1. Stderr is:

```json
{"error":"FACTORY_NONCE must be an integer","code":"VALIDATION"}
```

Record receipts on a fresh Anvil. Deploy on 8546 consumes the deployer nonce, so this command uses port 8548:

```bash
HARNESS_ANVIL_PORT=8548 npm run anvil
HARNESS_RPC=http://127.0.0.1:8548 npm run manifest:local
```

Stdout is:

```json
{"mode":"executed","chainId":31337,"factory":"0x5FbDB2315678afecb367f032d93F642f64180aa3","steps":18}
```

These three commands exit 1 and do not broadcast:

```bash
npm run manifest -- broadcast
npm run preflight:sepolia
npm run deploy:sepolia
```

`npm run manifest -- broadcast` prints `{"error":"Sepolia broadcast stays a dry run. briefs/grok/G10-harness-deploy.md does not approve a funded deploy","code":"SEPOLIA_BLOCKED"}`. The other two print `{"error":"Sepolia broadcast is blocked until LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1","code":"SEPOLIA_BLOCKED"}`. On the 2 Oct 2026 run the dry runs and `manifest:local` passed, `FACTORY_NONCE=no` exited 1 with `VALIDATION`, and these three commands exited 1 with `SEPOLIA_BLOCKED`.

## Known gaps

This pass did not close these limits.

- Public Sepolia was not broadcast. `npm run manifest -- broadcast`, `npm run preflight:sepolia`, and `npm run deploy:sepolia` exited 1 with `SEPOLIA_BLOCKED`.
- Arbitrum One was not used. Chain 42161 stays refused.
- The console was checked with `curl`. No browser rendered the page.
- `CreditFacility` is constructed with the zero address as its oracle, so this deploy does not check the peg.
- `npm run bytecode` ignores compiler immutable spans. A difference only in those spans still matches. The fresh manifest matched 18 of 18. After `stage1.registerPlatform` it matched 19 of 19.
- The 5000-share `received` value follows the seconds left in the weekly window. This pass printed `5066341700`. An earlier pass the same day printed `5066853400`.
- `forge test` and the engine suite were not re-run. The last recorded results remain 181 passed and 65 passed.
- The repo has no git remote, so GitHub Actions has not run. [U] until a remote exists and a run is green.
- The harness secret scan skips `lib`. Vendored `contracts/lib/forge-std` still contains Foundry's published default Sepolia RPC, the same URL as upstream `StdChains.sol` (https://github.com/foundry-rs/forge-std/blob/master/src/StdChains.sol). Of 1077 tracked paths, none is an `.env`. The text scan found no private key beyond the published Anvil keys, and no RPC token outside that vendored file.

## Next steps

- Read [the harness overview](../../README.md) for the path from Anvil to one CLI call.
- Read [the architecture notes](../../../docs/ARCHITECTURE.md) for the stage map and the signature domain.
- Read [the test notes](../../../docs/TESTING.md) for what each harness test covers.
- Read [the harness security notes](../../../docs/SECURITY-NOTES-harness.md) for the review findings.
- Read [the offline Sepolia fork checks](sepolia-fork-offline.md) for the nine fork tests and the commands that stay off the public RPC.
