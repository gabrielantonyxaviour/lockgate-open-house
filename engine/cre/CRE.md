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

`cre-tick` reads the JSON, checks the chain with `assertTransactableChain`, and for each request:

1. `quoteExit`. A refusal is a skip plus an alert. The first block code is the skip code (`gated`, `stale-nav`, `reserve`, …).
2. `routeVaults` with `lowest-fee`, `most-capacity`, or `round-robin`.
3. `buildProposal` against the chosen mandate. Calldata targets `submitProposal`. `signature` stays `0x`.

Mainnet chain ids throw `mainnet-forbidden` before any proposal is built. The example refuses chain 1 and chain 42161. A gated request on 31337 produces zero proposals and skip code `gated`.

Each built proposal also carries `partner.submitCalldata`. That calldata is `submitProposal` for the same `AdvanceProposal` the vault hashes. `partner.digest` equals the proposal digest. Filing it is `filePartnerProposal`, which encodes that call and uses a sender the caller passes in. The tick does not call that sender. There is no `execute` or `approve` encoder in this package.

To run it: `npx vite-node src/cli.ts cre-tick --file cre/config.json` from `engine/`.
