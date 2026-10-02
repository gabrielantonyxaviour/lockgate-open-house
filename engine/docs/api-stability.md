# API stability

`@lockgate/engine` is private and its `package.json` version is `0.1.0`. That number is not a compatibility promise. This note says which calls you can rely on, and which names a later edit can change.

> **Note:** The package has no `exports` map and is not published. Use the CLI and the on-chain bytes as the stable surface. A barrel import is for this repo.

## Rely on these

The commands are `example`, `quote`, `score`, `alerts`, `propose`, `sweep`, `facility`, `backtest`, `cre-tick`, `cre-sweep`, and `check`. You run them with `npx vite-node src/cli.ts` from `engine/`. The `lockgate-engine` bin points at `src/cli.ts`.

`check --file` reads a config and writes `{ ok, findings }`. A finding keeps `area` (`mandate`, `adapter`, or `limit`), `path`, `ok`, `code`, and `message`. `ok` is true only when those findings pass and the routed vault would sign. An invalid config exits 0 with `ok` false. Exit 1 stays `{ error, code }` when the file is missing or is not a JSON object.

A failure is one object, `{ "error", "code" }`, and it has no stack. An unreachable RPC uses code `rpc` and the message `rpc request failed`. That object does not include the URL, the response body, or a stack. A quote the model refuses still exits 0 with `available: false`. The codes in the [README](../README.md) error table are the ones the CLI documents. A new code can appear. The object keeps those two fields.

`propose` signs domain `LockgateAdvance` version `1`, and the verifying contract is the vault. The filing calldata is `submitProposal` only. `quoteId` is the bytes the vault stores. `repay` and `markLate` are the credit-line calls. [interface.test.ts](../test/interface.test.ts) pins the digest vector and those selectors. Change that encoding only by shipping a new domain version.

Mandate documents use `lockgate://schema/mandate/2`. A version 1 mandate names the tenor `maxTenor`, and the loader copies it to `maxTenorSeconds`. Config documents use `lockgate://schema/config/2`. There is no published config schema for version 1. A file may omit `schemaVersion`. Don't add or remove a required field inside an existing id. Ship a new shape as a new id plus a migrator.

An audit line is `seq`, `prev`, `kind`, `decision`, and `hash`. `hash` is sha256 over the canonical JSON of the first four fields. The first `prev` is sha256 of the text `lockgate-audit-v1`. Replay of a file you already wrote depends on that encoding.

`backtest --report` writes `backtest-report.json` with `kind` set to `backtest-report`. Each row is `sourced` or `synthetic`. A sourced row has an `http` or `https` URL.

Signing and broadcasting allow chain ids `31337`, `421614`, and `11155111`. Any other chain id is refused.

## Expect these to move

`src/index.ts` re-exports helpers for this repo. Adding or dropping a barrel name does not by itself change the CLI.

A JSON result can gain a field. Don't depend on a field being absent. The fields the README names stay: a quote keeps `available`, `feeBps`, `fee`, and `payout`; a proposal keeps `submittable`, `digest`, and `signature`; a dry run keeps `sent: false` and an action `send: false`.

`DEFAULT_PARAMS` is a product decision, not a frozen market card. A change is deliberate and updates the recorded tests. `DEPLOYMENTS` copies published addresses and can be corrected when a source changes. An adapter read can gain a field.

Anything `src/index.ts` does not export is internal. That includes the curve, the wait helpers, and the ABI constants.

## When a break is real

Rename a command, remove a field the README names, change the failure object, or edit `LockgateAdvance` version `1` only when you can tell the new behavior from the old one. A schema break is a new `lockgate://schema/...` id and a migrator, which is how `maxTenor` became `maxTenorSeconds`.
