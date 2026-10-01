# Lockgate engine

## SUMMARY

Off-chain pricing, risk, and EIP-712 advance proposals for Lockgate. The engine reads queue state, scores the platform, prices the wait, and builds `submitProposal` calldata. It does not sign with a partner key, does not broadcast, and does not deploy. Quotes, the fee identity, and the worked examples are in `MODEL.md`.

## PROGRESS

- 2026-10-01. Pricing curve, risk score, four queue wait models, read-only Kasu / Maple / USD.AI adapters, proposal builder, mandate router, sweeper planner, in-process alerts, backtest, CRE-equivalent tick, CLI. `npx vitest run` and `npx tsc -p tsconfig.json --noEmit` green before the engine commit. G7's partner digest does not match G6's `AdvanceProposal`; the difference is in `contracts/INTERFACE-REQUESTS.md`. No Anvil was started by this work. No mainnet transaction.

## Run

Node 22 or newer. From this directory:

```
npm install
npm test
npx tsc -p tsconfig.json --noEmit
npx vite-node src/cli.ts example --name epoch
npx vite-node src/cli.ts cre-tick --file cre/config.json
```

`tsx` is not a dependency. Node's type stripper does not rewrite the `.js` import specifiers, so the CLI entry is `npx vite-node src/cli.ts`. Tests call the exported `run`.

Commands: `example` (`--name` weekly, epoch, quarterly, fifo, demo), `quote`, `score`, `alerts`, `propose` (`--file`, optional `--sign-env NAME`), `sweep`, `backtest` (`--scenario`), `cre-tick`. JSON in, one JSON object on stdout. Logs are JSON lines on stderr. Amounts are decimal strings. A refused quote is a successful JSON result with `available: false`. Bad input is `{ "error", "code" }` and exit code 1.

`propose --sign-env` reads a hex private key from that variable. The process never prints the key. Do not put a key in a file that will be committed. The only key used in tests is the public Anvil account 0, and only inside the test process.

`cre/config.json` is a local tick on chain 31337. It is not a deployment.

## Layout

`src/quote.ts` prices. `src/pricing/` is the curve and defaults. `src/risk/score.ts` scores. `src/adapters/` waits and reads. `src/proposal/` builds, routes, and signs. `src/sweep/` plans repayment. `src/backtest/` replays named scenarios. `src/cre/tick.ts` is the cron stand-in. `src/alert/` records alerts.

## Boundaries

Edit surface for this package is `engine/**` plus an append to `contracts/INTERFACE-REQUESTS.md`. Reads of public contracts are allowed. Sends are not. Forbidden chain ids are in `src/chains.ts`.
