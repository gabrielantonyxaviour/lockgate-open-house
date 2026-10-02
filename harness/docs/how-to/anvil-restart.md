# Restart Anvil during a demo

A demo step is stored only after it succeeds. Stopping Anvil mid-run does not replay that step, and it does not keep calling addresses on an empty chain.

Leave port 8545 alone. Leave `harness/deployments` alone. `test/restart.test.ts` uses a private Anvil and a manifest in the temp directory.

## What happens

The test deploys, then registers the weekly platform as the stage 1 step. That writes the cursor. It then stops Anvil.

The next `demo.stage1` fails before a transaction. stderr is one object:

```json
{"error":"RPC is unreachable","code":"RPC"}
```

The cursor and the manifest keep the same bytes.

A new Anvil on the same port starts at block 0. The contracts from the manifest are not there. The same call fails before a transaction:

```json
{"error":"Manifest contracts are not on this chain","code":"NOT_DEPLOYED"}
```

The saved step is not printed. Both files stay unchanged. Deploying again writes a new manifest on that chain. `demo.stage1` then runs from the start and returns `lateAdvance`. The next call returns the same object, and the block number does not change.

On 2 Oct 2026 the harness suite, including this test, passed 96 and failed 0 in 50323.4 ms. This test took 763.142584 ms inside that run.

## Run the check

From `lockgate/repo/harness`:

```bash
node --import tsx --test --test-concurrency=1 test/restart.test.ts
```

The closing lines are `tests 1`, `pass 1`, and `fail 0`. The test stops the Anvil it started.

A call that begins while the process is down is `RPC`. A call after a fresh process, before you deploy, is `NOT_DEPLOYED`. After that deploy, a finished stage is recognized from the new chain and from the new cursor. The old chain's partial register is not continued.

The same `runStep` rule covers `demo.stage2`, `demo.stage3`, and door 2. One-shot action ids are not stored in the cursor. The click-through on a chain you do not restart is in [run-on-anvil.md](run-on-anvil.md).
