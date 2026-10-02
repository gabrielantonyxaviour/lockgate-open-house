# CRE equivalent

## SUMMARY

`runCreTick` in `src/cre/tick.ts` is the local stand-in for a Chainlink CRE cron. It prices each request, routes a partner vault, and returns `submitProposal` calldata. It does not import `@chainlink/cre-sdk`, does not read a secret, and does not broadcast. `config.json` uses chain id 31337. Amounts are decimal strings.

## What a real workflow would look like

Chainlink's TypeScript workflow is a `workflow.yaml` plus a `config.json`, and the handler is registered with `CronCapability.trigger({ schedule })`. The cron expression may have 5 or 6 fields. The shortest interval the docs allow is 30 seconds. A 6-field `0 */10 * * * *` is every 10 minutes.

- Cron trigger: https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts
- `workflow.yaml` keys (`workflow-name`, `workflow-path`, `config-path`, `secrets-path`): https://docs.chain.link/cre/reference/project-configuration-ts
- On-chain write is a separate SDK path (`runtime.report` then `evmClient.writeReport`). This package does not call it. https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-ts

`workflow.yaml` in this directory uses that file shape so a later CRE project can point at the same config. `workflow-path` names the engine tick, not a CRE `main()` that compiles to WASM. `secrets-path` is empty. There is no production target and no workflow-owner address, because registering a workflow would be a send this package does not do.

## This tick

`cre-tick` reads the JSON, migrates it to config schema version 2, and checks the chain with `assertTransactableChain`. A version 1 mandate field `maxTenor` is copied to `maxTenorSeconds`. The published schemas are `configJsonSchema()` (`lockgate://schema/config/2`) and `mandateJsonSchema()` (`lockgate://schema/mandate/2`). A file that already uses `maxTenorSeconds` needs no `schemaVersion`. The published schema still requires `schemaVersion: 2` and rejects `maxTenor`. `canonicalConfig` is that document. Amounts in the schema are a decimal string or a safe integer. For each request:

1. If the request includes one of `kasu`, `maple`, or `usdai`, copy that read onto the quote first. Two reads, or a read missing fields, is `param`. Then `quoteExit`. A refusal is a skip plus an alert. The first block code is the skip code (`gated`, `illiquid`, `stale-nav`, `reserve`, …).
2. `routeVaults` with `lowest-fee`, `most-capacity`, or `round-robin`.
3. `buildProposal` against the chosen mandate. Calldata targets `submitProposal`. `signature` stays `0x`.

Mainnet chain ids throw `mainnet-forbidden` before any proposal is built. The example refuses chain 1 and chain 42161. A gated request on 31337 produces zero proposals and skip code `gated`. `creEntry` is the handler to call from outside: it returns the tick, or `{ error, code }` when the config is invalid or the chain is forbidden, and it does not throw.

Each built proposal also carries `partner.submitCalldata`. That calldata is `submitProposal` for the same `AdvanceProposal` the vault hashes. `partner.digest` equals the proposal digest. Filing it is `filePartnerProposal`, which encodes that call and uses a sender the caller passes in. The tick does not call that sender. There is no `execute` or `approve` encoder in this package.

To run it: `npx vite-node src/cli.ts cre-tick --file cre/config.json` from `engine/`. `check --file` reads the same document and writes `{ ok, findings }` for the mandates, the adapter reads, and the limits. It prices each request the way the tick does, and `ok` is true only when the routed vault would sign. An invalid config exits 0 with `ok` false. It does not broadcast.

## Sweep simulation

`runCreSweep` in `src/cre/sweep.ts` is the local stand-in for a cron that plans `repay` and `markLate`. The input is the sweep book plus a `schedule`. A 6-field cron whose seconds fire closer than 30 seconds apart is `param`. A 5-field cron is at least one minute. `TZ=Area/City` is accepted in front of the fields. https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts

`cre/sweep-workflow.yaml` uses the same project keys as the advance file, with `broadcast: false` and an empty `secrets-path`. `cre/sweep-config.json` is chain 31337. `fixtures/sepolia/cre-sweep.json` is chain 421614.

The result is a simulation. `mode` is `simulate`, `broadcast` is false, `onReportCalled` is false, and `txHash` is null. Chainlink's `cre workflow simulate` records the report on a `MockKeystoneForwarder` and leaves `onReport` uncalled. https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-ts

On chain 421614 the recorded forwarder is `MockKeystoneForwarder` at `0xd41263567ddfead91504199b8c6c87371e83ca5d`, chain name `ethereum-testnet-sepolia-arbitrum-1`. On chain 11155111 it is `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, chain name `ethereum-testnet-sepolia`. Chain 31337 has no directory row, so the forwarder address is null. The production `KeystoneForwarder` addresses are not selected. A tenant's own list comes from `cre workflow supported-chains` after `cre login`, and that command was not run, so a tenant-specific address stays [U]. https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts

A partner vault stays in the plan with `sendable` false. The harness does not call `broadcastOwnBook`, does not dial, and does not import `@chainlink/cre-sdk`. Chain ids other than 31337, 421614, and 11155111 throw `mainnet-forbidden`.

To run it: `npx vite-node src/cli.ts cre-sweep --file fixtures/sepolia/cre-sweep.json` from `engine/`.
