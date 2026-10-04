# Cloudflare API runtime

The production Worker serves the Vite assets and the existing `/api/demo/*` API.
One SQLite Durable Object (`arbitrum-sepolia-production-v1`) serializes API work,
preserves sessions/challenges/profiles/legal documents/outbox, and owns the signed
transaction journal. No Mac, tunnel, container filesystem, or private asset file
is needed at runtime. `open-house.lockgate.finance` redirects permanently to the
canonical `openhouse.lockgate.finance`, preserving the path and query.

## Build and configuration

Run from the repository root:

```sh
node cloudflare/build.mjs
npx --yes wrangler@4.147.0 types --config cloudflare/wrangler.local.jsonc --include-env=false cloudflare/build/worker-configuration.d.ts
./harness/node_modules/.bin/tsc -p cloudflare/tsconfig.json
./harness/node_modules/.bin/tsc -p harness/tsconfig.json
```

`app/wrangler.jsonc` owns production configuration. Its main points to
`../cloudflare/build/worker.js`; ASSETS runs the Worker first. Bind `LOCKGATE_API`
to `LockgateApi` with a SQLite migration. Keep `nodejs_compat` enabled.

Variables: `LOCKGATE_RUNTIME=cloudflare`,
`LOCKGATE_DEMO_NETWORK=arbitrum-sepolia`, `LOCKGATE_DEMO_ASSET=mock`,
`LOCKGATE_PUBLIC_ORIGIN=https://openhouse.lockgate.finance`.

Provision Workers secrets without printing them:

- `LOCKGATE_DEMO_RPC_URL`: private HTTPS QuickNode endpoint.
- `LOCKGATE_SIGNERS_JSON`: the existing 16-account signer file, unchanged.
- `LOCKGATE_IMPORT_TOKEN`: random temporary bootstrap token.
- Optional `LOCKGATE_RESEND_API_KEY` and `LOCKGATE_EMAIL_FROM` for acknowledgements.

Public bundles contain ABI metadata and the existing custom-asset manifest and
fixture. They never import signer files, state, outbox or `.env` files. Paxos
migration is not part of this deployment.

## One-time state import

Until imported, the API returns 503 `SERVICE_INITIALIZING`. POST JSON to
`/api/demo/admin/import`, authenticated with `Authorization: Bearer <bootstrap>`.
The body may be the existing `scripts/demo/local/public-sepolia-state.json`, or
an envelope `{ "state": <existing state>, "outbox": { "ENQ-...": <email record> } }`.
Use the envelope when existing `scripts/demo/local/email/ENQ-*.json` files exist.
The SQLite import is atomic, validates input, and refuses any overwrite with 409.
After confirming counts, delete `LOCKGATE_IMPORT_TOKEN` from Workers secrets.
The endpoint then returns 404. Never embed this private import in public assets.

## Recovery behavior

Server-originated transactions persist the exact signed raw transaction and hash,
and await durable storage before broadcasting. Retries reuse that transaction;
a different action from the same signer is blocked while its prior transaction is
unresolved. Completed/reverted hashes are retained. Pending holding issuance also
retains its holding ID. Wallet-originated broadcasts continue through the wallet.
An unresolved transaction returns `TRANSACTION_PENDING`; retry the same action.
Do not delete the journal or send another nonce to work around it.

The original exact-document and wallet-bound authorization checks still run.
A pending action whose signed terms have expired may require operator recovery;
it is never silently submitted as a second transaction with fresh terms.

Email delivery is reported as accepted only after Resend returns success and an
ID. Restricted send-only API keys do not require the domains-list permission.
Absent/rejected sender configuration retains a durable queued/retry outbox item;
retry happens when the original enquiry is submitted again with its request ID.

## Local checks

Create ignored `cloudflare/.dev.vars` containing the three required secrets.
Run local Wrangler on port 8791 using `cloudflare/wrangler.local.jsonc` and
`--persist-to cloudflare/.wrangler/local-test`. `node cloudflare/smoke-local.mjs`
imports a local copy of state, then checks live Sepolia read-only RPC,
authentication, replay, origin denial, and private RPC redaction. It creates only
local sessions. `node cloudflare/check-persistence.mjs --prepare`, reload the
Worker, then run without the flag to check retained session/profile/challenge.

From `harness`, `node --import tsx --test test/demo-transactions.test.ts` simulates
a lost broadcast response and proves durable-before-broadcast ordering, identical
raw transaction recovery, unresolved nonce exclusion, and completed deduplication.
These checks send no testnet transactions or email. Live production and funded
wallet journeys must be verified separately by the deployment coordinator.
