# Entry and onboarding verification — 4 October 2026

The compact entry flow is deployed at [openhouse.lockgate.finance](https://openhouse.lockgate.finance) and [open-house.lockgate.finance](https://open-house.lockgate.finance). All checks below passed after the final frontend edit.

## Delivered behavior

| Entry state | Result |
| --- | --- |
| Investor or issuer introduction | Shorter headings: 32px desktop/tablet, 28px phone. Repeated benefit rail removed; wallet and next step remain prominent. |
| Explore platform terms | Standalone read-only list and detail pages. No sidebar, dashboard, or financial action form, whether connected or disconnected. |
| Terms detail, reload and return | The deep link reloads; issuer/investor origin is preserved by the return link. Unknown addresses have an explicit missing-record state. |
| Disconnected issuer introduction | No local facility draft action. Wallet connection is the primary step. |
| Connected new issuer | Start platform onboarding leads to the standalone draft form, including when public reads fail. |
| Existing issuer | Direct issuer workspace shortcut remains available. |
| Direct disconnected onboarding link | Connect issuer wallet gate appears before the form. Explicit layout preview remains available for regression inspection. |
| Facility planning | Existing validation, local save/restore, export and clear behavior retained. Preparing a plan does not submit an application or activate credit. |

## Verification

| Check | Result |
| --- | --- |
| Production build, TypeScript, lint, diff checks | Passed. |
| App unit tests | 157 passed across 14 files. |
| Regular browser suite | 34 passed; three opt-in fork cases skipped. Nine new checks cover connected terms, origin-aware return, missing deep links, RPC failure, issuer access and compact responsive headings. |
| Entry visual inspection | Eight surfaces at 375/768/1440px, with zero overflow and no runtime errors. |
| Terms state checks | Loading, error, empty, missing, loading detail and issuer read failure passed using explicit controlled snapshots. |
| Actual Sepolia terms reads | Inspected at 375/768/1440px; duplicate global status row hidden. |
| Deployed checks on both domains | HTTP 200, correct production bundle, real terms list/detail, reload/return, disconnected wallet gate and connected local form passed. Eighteen route/width checks, zero overflow or runtime exceptions. |

[Visual/state evidence](../app/docs/proof/entry-refinement/visual-checks.json), [terms state checks](../app/docs/proof/entry-refinement/state-checks.json), [public read checks](../app/docs/proof/entry-refinement/public-terms-checks.json), and [deployed verification](../app/docs/proof/entry-refinement/live/verification.json) record the observations. The [review gallery](proof/index.html) includes 45 new screenshots; the phone, tablet and desktop output was inspected visually.

## Deployment and provenance

- Frontend source checkpoint: `62be4b0f3ac066984fd405733914ca615217168d`, branch `feat/approved-exit-desk`, pushed and verified against GitHub.
- Cloudflare worker: `lockgate-open-house`; version `c03610cd-5655-4efb-9c79-fe5ed4b3f98e`.
- Both domains served `/assets/index-E-gtT276.js`. Public reads observed blocks 315529296 and 315529351 during the deployed checks.
- [Source and screenshot manifest](../app/docs/proof/entry-refinement/source-and-artifacts.json) hashes all retained captures and verifies every current app source file against the source checkpoint.
- Connected deployed checks use a read-only EIP-1193 account-restoration bridge. Balances, permissions and terms come from the actual public RPC. No transaction was sent; a native extension popup was not tested in this pass.
- Only seven entry/routing/layout source files differ from the earlier signed proof checkpoint. Wallet, contract-action, signing, engine and backend implementations did not change.
- The [previous signed wallet report](APP_VERIFICATION.md) retains 75 browser-signed transactions against pinned source `da155589`. Those recordings were not rerun for this entry refinement. The integrity checker now accepts `--source-ref` so historical evidence remains verifiable without claiming it matches newer UI source.

## Reproduce

From `repo/app`: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`; after an authorized Open House deploy, run `node test/check-entry-live.mjs`.

From `repo`: `python3 scripts/build-app-proof.py --run run-1791063405834 --run remaining-1791063297328` rebuilds the local gallery. `python3 scripts/check-app-proof.py --source-ref da155589d45f820cd50f7ad8ef3741bc16595809 --run run-1791063405834 --run remaining-1791063297328` verifies the retained signed receipts, artifacts and historical source.
