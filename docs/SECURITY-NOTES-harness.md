# Security notes — harness

## SUMMARY

Reviewed the harness, the local deploy scripts, and the loopback test console on 2026-10-02. The pass covered access control, reentrancy, rounding, oracle staleness, signature replay, denial of service, griefing, and economic attacks. Seven findings were fixed under `harness/` and `scripts/start-anvil.ts`. Regressions are in `harness/test/security.test.ts` and `harness/test/flows.test.ts`, with the Anvil nonce and cross-vault checks in `harness/test/failures.test.ts`. This is not a pentest and not a legal opinion. The console moves Anvil test funds only.

## Findings

| Id | Class | What was wrong | Fix |
|---|---|---|---|
| H-1 | Access | `loadCtx` and `deployProtocol` dialed whatever URL was in the manifest. A public host, or port 8545, would send the published Anvil keys. `Number("08545")` is 8545, so a leading-zero port was the shared node. | `assertLocalRpc` allows `127.0.0.1`, `localhost`, and `::1`, requires an explicit port, and refuses 8545. `assertAnvilPort` accepts decimal text in 1024–65535 and refuses the same alias. Both run before any local RPC call. |
| H-2 | DoS | `readBody` buffered the whole POST. One request could hold the console open. | Declared `content-length` and accumulated bytes both stop at 8 KiB with `VALIDATION`. |
| H-3 | Economic | `JSON.parse` rounds numbers past 2^53, and the act parser then called `String()` on the rounded value. A large nav could be quoted as a different amount. | Act `input` values must already be strings of at most 256 characters. A number or a boolean is `VALIDATION` and makes no chain call. |
| H-4 | Replay | `draftProposal` signed from the router slice. The router's probe uses nonce 0, request id 0, and `expiresAt` equal to the block timestamp, so a slice can exist for a proposal the vault will reject. `submitProposal` stores that digest and the nonce stays occupied until the owner cancels it. | Before return, the draft checks the mandate payout, `nonceUsed`, and `proposalHashOf`. `preview` of the exact struct must be `None`. A used nonce is `REPLAY`. The failure test still submits a rejected proposal directly, so the contract's pin-then-reject path stays covered. |
| H-5 | Access | `signProposal` signed any `chainId` the caller passed. A 42161 or 421614 signature could be produced from the helper. | `assertHarnessWrite` runs before `signTypedData`. Chain 42161 is `MAINNET_REFUSED`. Every other chain is `CHAIN_REFUSED`. A fee that leaves no payout, or a payout other than nav minus fee, is `VALIDATION`. |
| H-6 | DoS | Two `POST /api/act` calls could overlap and interleave nonce and cash. | The act route runs through `inOrder`. A failed action does not block the next one. The lock is not inside `send`, so `demoAll` cannot deadlock on its own calls. |
| H-7 | Access | `deployProtocol` wrote the manifest before the nonce check and the seed mint. A refused deploy left predicted addresses on disk, and the next command treated them as live. | The file is written after the seed mint. `NOT_FRESH` leaves the previous bytes in place. |

## Reviewed, no code change

- Local writes already require chain 31337. Chain 42161 is `MAINNET_REFUSED` before a transaction. The Sepolia script checks `LOCKGATE_ALLOW_SEPOLIA_DEPLOY` before it reads an RPC, then refuses 42161 before it broadcasts. That path stays able to reach a remote 421614 node when the operator sets the flag. `assertLocalRpc` is not applied there.
- The console listens on `127.0.0.1`. Static files are exactly `/` and `/app.js`.
- The manifest stores addresses. It does not store private keys. The deploy scripts do not print the key.
- `PegOracle` is deployed only inside the failure test. A zero oracle leaves the peg check off. With an oracle set, a low price is preview reason 11 and a stale update is reason 12. `approve` then reverts `MandateRejected` and idle does not move.
- Stage-1 `feeFromBps` stays on the ceiling. `feeFromBps(1, 1)` is 1. Half-up would be 0. `modelFeeBps(300)` is 49. `modelFeeBps(86400)` stays above 1500, which is what the chain refuses. Partner fees stay on the router's half-up amount. Rechecking them with the ceiling formula would reject a valid mandate fee.
- Door 2 registers the exit pool at reserve bps 0. After settle, partner idle is unchanged. The facility governor and the borrower are different addresses. Lockgate cannot withdraw, pause, set a mandate, or enlist a partner vault. `relayRepay` checks that the router balance returns to where it started.
- CREATE2 salts are `lockgate.protocol.<logical>.v1`. Addresses follow the factory, the salt, and the init code. A clone from `FundFactory` starts at zero shares, so the weekly short-cash path stays a direct CREATE. An external asset sets `mintYield` false and skips `setMinter`.
- The harness is off-chain and has no token callback. Pay paths on the contracts use `nonReentrant`. This pass did not change `contracts/src`.

## Residual

- The console has no authentication. Any process that can open `127.0.0.1` can move the Anvil test funds.
- The published Anvil keys must not be funded on a public network. A manifest whose addresses were swapped would still be called with those keys. The loopback check limits that to a local node. A hosts file can remap the name `localhost`. `127.0.0.1` does not follow that remap.
- `preview` and `submitProposal` are one block apart. A mandate change in between can make a drafted proposal fail at submit, and a passing submit still stores the digest until the vault owner cancels it.
- `exitRef` is `keccak256` of the nonce, the strategy, and the nav. It does not include the vault. The same triple collides.
- The harness does not call the engine CLI. The engine's vault reads are a separate path.
- Setting `LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1` still allows a broadcast to chain 421614. This pass did not set that flag and did not call the public Sepolia URL.
- The repo has no git remote, so GitHub Actions has not run this workflow. [U] until a remote exists and a run is green.
