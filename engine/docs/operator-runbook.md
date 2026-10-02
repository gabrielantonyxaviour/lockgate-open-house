# Operator runbook

Install the engine, run every command, and recover when a command exits 1. These steps price an exit, build a proposal, and plan a sweep. They do not send a transaction.

Run every command from `engine/`, the directory that contains `package.json`. Stdout is one JSON object. Stderr is a JSON log line with `ts`, `level`, `event`, and `command`. A quote the model refuses still exits 0. Bad input exits 1 and adds `{ "error", "code" }` on stderr. The stack is not included.

Fee math is in [MODEL.md](../MODEL.md). The CRE stand-in is in [CRE.md](../cre/CRE.md).

## Before you run

- Use Node.js 22 or newer. `package.json` sets `engines.node` to `>=22`.
- Stay in `engine/`.
- `npm test` needs `forge` on `PATH`. The suite starts Anvil on the first free port from 8546 and stops that process. Leave port 8545 alone.
- Pass `--rpc` only for a vault you deployed at `http://127.0.0.1:8546` whose chain id matches the file. Do not use a public RPC.
- Keep the signing key in the process environment. Pass the variable name to `--sign-env`. Do not write the key into a file you will commit.

## Set up

1. Check Node:

   ```bash
   node -v
   ```

   The major version must be 22 or greater.

2. Install the packages:

   ```bash
   npm install
   ```

   The runtime dependencies are `viem` and `zod`.

3. Write an epoch request and price it:

   ```bash
   npx vite-node src/cli.ts example --name epoch > /tmp/lockgate-epoch.json
   npx vite-node src/cli.ts quote --file /tmp/lockgate-epoch.json
   ```

   The quote stdout has `available` true, `feeBps` 109, `fee` `"109000000"`, and `payout` `"9891000000"`. That is 109 USDG on a 10,000 USDG face. `tsx` is not installed. Node does not rewrite the `.js` import specifiers, so the entry stays `npx vite-node src/cli.ts`.

## Environment variables

Set names, not key material, in the shell.

| Name | When you set it | Accepted values |
|---|---|---|
| `LOCKGATE_LOG_LEVEL` | Optional. The default is `info`. | `debug`, `info`, `warn`, or `error`. Any other string is treated as `info`. |
| The name you pass to `--sign-env` | Only when you want a signature. This runbook uses `LOCKGATE_PROPOSER_KEY`. | A hex private key. The name matches `^[A-Za-z_][A-Za-z0-9_]{0,80}$`. |

`LOCKGATE_LOG_LEVEL=error` prints no info line. An unrecognized level still prints the info line:

```bash
LOCKGATE_LOG_LEVEL=error npx vite-node src/cli.ts quote --file fixtures/sepolia/quote.json
```

Export `LOCKGATE_PROPOSER_KEY` in the same shell, then pass the name. Do not echo the value.

```bash
npx vite-node src/cli.ts propose --file fixtures/sepolia/propose.json --sign-env LOCKGATE_PROPOSER_KEY
```

If that variable is missing or is not hex, the process exits 1 with code `param` and message `signing env is missing or not hex`. It does not print the value. Omit `--sign-env` when you want `signature` null.

## Commands

Amounts are decimal strings of 6-decimal USDG units. The files in [fixtures/sepolia/](../fixtures/sepolia/) use chain 421614 and do not call a public RPC.

| Command | Flags | Result on the fixture |
|---|---|---|
| `example` | `--name` `weekly`, `epoch`, `quarterly`, `fifo`, or `demo` | `{ input, params }`. `epoch` sets `input.kind` to `epoch` and `params.timeScale` to 1. |
| `quote` | `--file` | `available` true, `feeBps` 109, `fee` `"109000000"`, `payout` `"9891000000"`. |
| `score` | `--file` | `bps` 825, plus `repayment`, `queue`, `gating`, `nav`, and `concentration`. |
| `alerts` | `--file` | `[]`. |
| `propose` | `--file`, optional `--rpc`, `--sign-env` | `submittable` true, `domain.chainId` 421614, `signature` null until you sign. |
| `sweep` | `--file`, optional `--report` | One `repay` row with `sendable` true. Stdout stays the action list. A report file is written under `reports/`, or under `--report`. |
| `facility` | `--file` | `solvent` true, `availableDraw` `"700000"`, `canFund` true. |
| `backtest` | `--scenario` | `epoch-repay` returns `feeEarned` `"109000000"`, `loss` `"0"`, `refused` 0. `gated-refuse` returns `feeEarned` `"0"`, `loss` `"0"`, `refused` 1. |
| `cre-tick` | `--file` | One proposal with `submittable` true and chain 421614. |
| `cre-sweep` | `--file` | A simulation with `onReportCalled` false and one `repay` action. `fixtures/sepolia/cre-sweep.json` is chain 421614. |
| `check` | `--file` | `{ ok: true }` on `fixtures/sepolia/cre.json`. It prices the book and follows the `cre-tick` route. Each finding has `area`, `path`, `ok`, `code`, and `message`. An invalid config still exits 0 with `ok` false. A file that is not a JSON object, including `[]`, exits 1. |

`backtest --scenario` also accepts `kasu-repay-slash`, `stale-refuse`, `busy-book`, and `reserve-short`.

```bash
npx vite-node src/cli.ts example --name epoch
npx vite-node src/cli.ts quote --file fixtures/sepolia/quote.json
npx vite-node src/cli.ts score --file fixtures/sepolia/quote.json
npx vite-node src/cli.ts alerts --file fixtures/sepolia/quote.json
npx vite-node src/cli.ts propose --file fixtures/sepolia/propose.json
npx vite-node src/cli.ts sweep --file fixtures/sepolia/sweep.json
npx vite-node src/cli.ts facility --file fixtures/sepolia/facility.json
npx vite-node src/cli.ts backtest --scenario epoch-repay
npx vite-node src/cli.ts cre-tick --file fixtures/sepolia/cre.json
npx vite-node src/cli.ts cre-sweep --file fixtures/sepolia/cre-sweep.json
npx vite-node src/cli.ts check --file fixtures/sepolia/cre.json
```

`engine/.gitignore` ignores `reports/`. Leave those files unstaged.

### Dry run

Add `--dry-run` with no following value. Stdout is `{ "dryRun": true, "command", "sent": false, "actions" }`. Every action has `send` false.

On a dry-run propose, `--rpc http://127.0.0.1:9` and a set `LOCKGATE_PROPOSER_KEY` are ignored. The action kind is `submitProposal`, `summary.signature` is null, and `data` starts with `0xe7c1fee8`. A dry-run sweep still reports kind `repay` and writes no report file.

### A refused quote

Exit 0 is success, including a book the model will not price. Set `input.gated` to true on a copy of `fixtures/sepolia/quote.json` and the quote exits 0 with `available` false, `feeBps` 0, `fee` `"0"`, and `payout` `"0"`. Read `blocks`, change the book, and run `quote` again.

## Failure codes and recovery

On exit 1, stderr is one error log line and then the JSON object. Match `code`, then apply the recovery for that row.

### `usage`

| What failed | `error` | Recovery |
|---|---|---|
| Unknown command | `commands: example, quote, score, alerts, propose, sweep, facility, backtest, cre-tick, cre-sweep, check` | Run one of those names. |
| A bare word after the flags | `unexpected argument` plus that word. A trailing `extra` produced `unexpected argument extra`. | Delete the extra word. Flags start with `--`. |
| A flag the command does not accept | `unexpected flag --` plus the flag. `quote --name` produced `unexpected flag --name`. | Use a flag from the command table. |
| `--dry-run` followed by a value | `pass --dry-run without a value` | Pass `--dry-run` alone. |
| A file command without `--file` | `pass --file` | Add `--file` and a path. |
| A missing path | `file not found` | Point `--file` at a file that exists. |
| `--name nope` | `input: Invalid option: expected one of "weekly"\|"epoch"\|"quarterly"\|"fifo"\|"demo"` | Pick one of those five names. |
| `--scenario nope` | `input: Invalid option: expected one of "kasu-repay-slash"\|"epoch-repay"\|"gated-refuse"\|"stale-refuse"\|"busy-book"\|"reserve-short"` | Pick one of those six names. |

### `param`

| What failed | `error` | Recovery |
|---|---|---|
| The file is not JSON | `invalid JSON` | Replace the file with JSON. |
| A number is outside the safe integer range | `navValue: number is outside the safe integer range; pass a decimal string` | Write the amount as a decimal string. |
| The body is missing a field | `platformId: Invalid input: expected string, received undefined` on `{}` | Start from the matching file in `fixtures/sepolia/`. The message names the first missing field. |
| `check` on a JSON array or other non-object | `config must be an object` | Pass a JSON object. `[]` is not a config. |
| `--rpc` is not an `http` or `https` URL | `input: rpc must be an http(s) URL` | Use `http://127.0.0.1:8546` for a local vault. |
| `--sign-env` is not a variable name | `input: sign-env must name an environment variable` | Pass `LOCKGATE_PROPOSER_KEY`, not the key. |
| The named variable is empty or not hex | `signing env is missing or not hex` | Export a hex key under that name, or drop `--sign-env`. |

### `amount`

`error` is `navValue must be between 1 USDG and 1e12 USDG`.

A face of `"1"` (below 1 USDG) and a face above 1e12 USDG both exit with this code. Write the face in 6-decimal units. 1 USDG is `"1000000"`. The epoch fixture uses `"10000000000"` for 10,000 USDG.

### `mainnet-forbidden`

`error` is `refusing to transact on chain 42161` when `propose`, `sweep`, `cre-tick`, or `cre-sweep` carries chain 42161.

1. Set `chainId` in the file to `31337`, `421614`, or `11155111`.
2. Run the command again.

The Sepolia fixtures use `421614`. `facility` has no chain id, so this code does not apply to it.

### `rpc`

| What failed | `error` | Recovery |
|---|---|---|
| `--rpc` does not answer, or the vault call fails in transport | `rpc request failed` | The process does not sign. Start the local vault, drop `--rpc`, or add `--dry-run` to skip the dial. The URL and the response body are not in the message. |

### `internal`

| What failed | `error` | Recovery |
|---|---|---|
| `--report` is a file, not a directory | `could not write the sweep report` | Pass a directory. The default directory is `reports/`. `--dry-run` writes no file. |

Any other unexpected throw also uses `internal`. The message is one line and is cut at 240 characters.

## Next steps

- Read [MODEL.md](../MODEL.md) for the fee, the queue clock, and the digest fields.
- Read [CRE.md](../cre/CRE.md) before you run `cre/config.json`. That file stays on chain 31337.
- Read the design table in [README.md](../README.md) when stdout exits 0 and `available` or `submittable` is false.
