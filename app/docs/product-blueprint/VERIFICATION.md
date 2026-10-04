# Blueprint review verification

## Wallet-first correction · revision 3

The latest [entry/build-order contract](journey-specs/entry-and-build-order.md)
supersedes the earlier preview's task-first arrival. The written blueprint now
requires connection/profile lookup before role choices, immediate exit-position
discovery, a transaction-backed Demo sheet and five funded TEST firm vaults.
The investor steps put discovery before eligibility review; stable review IDs remain.
Three new proposed acceptance IDs extend the financial demo plan to 24 checks.
This correction does not implement profile services, Demo minting or firm onboarding.
The 117 checks below verify the earlier screen artifact, not the revised wallet routing.
Revision 3 ES-module imports, stable IDs, discovery-before-eligibility order, 24
unique demo-check IDs, local links and file lengths passed. Its updated blueprint
sketch rendered without script errors or overflow at 375/768/1440 and was inspected.

## Four-persona review extension

Checked **4 October 2026**, final browser run completed before **07:48:05 UTC**.
This verifies the local planning artifact, not an implemented financial demo.

- [Visual walkthrough](http://127.0.0.1:5197/docs/product-blueprint/preview/):
  39 screen compositions across four personas, with reviewer-only scenario controls.
- [Written contracts](journey-specs/README.md): 44 persona screen rows, agreement
  responsibilities, 18 settlement/handoff states, ten policy decisions and 21 proposed
  executable demo checks. The screen compositions consolidate some written steps.
- Interactive blueprint: 46 journey steps, 75 screen/action groups, 171 feature
  checks, 13 money/ownership steps, nine identity/agreement steps, 18 decisions and
  11 release gates. These are specification counts, not passing financial tests.

### Reproduce the artifact checks

Use the already-running app server at port 5197. From `app/`, run:

```sh
node docs/product-blueprint/verify-preview.mjs
```

The script launches isolated headless Chromium, closes its browser on completion,
and writes an explicit result plus captures and an example export to its own
temporary directory. It does not attach to a user's wallet browser or restart Vite.

Final run: **PASS**, 117 screen/viewport combinations at **375, 768 and 1440**,
eight blocking scenarios with recovery, no page-script errors, no failed local
asset responses and no API/RPC or non-GET requests. Final rendered public arrival,
offers and provider records were inspected at phone, tablet and desktop widths.

Verified behavior:

- Four public tasks with no preselected workspace; no native select controls.
- Onchain matching skips the offchain record-link step; offchain linking needs
  deliberate consent. Birch permits only a whole-claim assignment. Elm remains
  conditional and prevents continuation.
- Invalid amounts stop quoting. Offers respect the example firm's face limit.
  Mutually exclusive routes for one firm/request share one capacity reservation.
- Two fictional firms quote different discounts. Northstar's selected 40,000-face
  offer keeps its counterparty, 3.5% discount, 200 fee, 38,400 net and 60,000 residual
  through review, agreement, receipt and downloaded example record.
- Signing consent precedes the local example transition; signed and paid screens
  are separate. The preview performs neither legal signing nor financial settlement.
- Provider A's 25,000 original shares reconcile to 4,000 redeemed, 6,000 queued
  and 15,000 free. Fixed claim cash is reserved before payment; provider B is a
  separate illustrative record, not an executed ownership-isolation test.
- Firm risk uses 40,000 face / 500,000 NAV = 8%; borrower repayment distinguishes
  39,000 principal, 390 separately agreed charge and 39,390 total.
- Blueprint deep links and updated counts work. Literal HTML-like review notes
  persist after reload as text without script execution in an isolated context.
- A separate export check passed after the last review-script edit: JSON includes
  revision 2 while retaining the v0.1 storage namespace and existing note IDs.

ES-module imports, unique journey IDs, required screen fields, Markdown local
links and file-length checks passed. No dependencies were installed. The actual
app/contract paths remain unchanged against application baseline `f16c4d4`.
Official ReUI onboarding-8, Maple queue and Docusign status references were checked;
their patterns do not establish licensed block-code acquisition or legal clearance.

All proposed `J-*` financial acceptance checks remain **unexecuted**. Five distinct
actor wallets, real TEST document execution, durable server-side authorization,
public-chain receipts, offchain registrar integration and individual provider
accounting must be proved after implementation. Nothing was deployed.

## Initial draft verification

Checked **4 October 2026**, completed by **04:06:50 UTC**.
Scope: the local discussion document, not a new app/contract release.

URL: <http://127.0.0.1:5197/docs/product-blueprint/index.html>

Application baseline: `f16c4d4a60914860b5b2386374710b1b998ff7c7`.
Review branch: `feat/reui-onboarding-local`.

## Content checks

| Inventory | Count |
|---|---:|
| Public personas | 4 |
| Journey steps with action/permission/confirmation/recovery | 43 |
| Screen/action groups | 69 |
| Feature acceptance checks | 153 |
| Shared UX patterns | 16 |
| Arrival rules | 8 |
| Money/ownership lifecycle steps | 11 |
| Identity/agreement lifecycle steps | 9 |
| Decisions | 17 |
| Release gates | 10 |
| User/failure scenarios | 26 |
| Separate demo candidates | 6 |
| Source references before deduplication | 38 |

Native ES-module imports, required journey fields, unique IDs within their data namespaces,
persona references and feature status values passed. Local source paths exist;
repository paths also exist at the pinned application checkpoint. HTTPS reference URLs
are syntactically valid; six UX sources were checked by the design reviewer and four
identity/signing/asset sources were checked during the planning pass.

All blueprint source files are under 300 lines. No application dependencies were added.

## Rendered and interactive checks

Headless Chromium rendered all ten sections at **375, 768 and 1440 pixels**.
With every detail expanded, page and panel overflow checks passed. Actual captures of
the overview, public-entry sketch, onboarding, provider step and decision state were
inspected. DOM IDs are unique and no page-script errors were observed.

- Provider filter returns 24 relevant groups; owner-only capital deposits are excluded.
- Internal filter returns seven internal groups. Search and no-results recovery work.
- Direct links expand the selected journey/step or decision and its containing details.
- Review checkbox and note persist after reload, including literal HTML-like text;
  that text is not executed as markup.
- Export downloads parseable JSON containing the correct blueprint/version, source,
  item ID, review state and note.
- Print preparation expands all details; post-print handling restores prior states.
- Unavailable/full browser storage preserves entered notes and displays export guidance.
- Invalid stored review data is rejected without clearing the stored record.

Checks used isolated browser contexts. They did not connect wallets, sign financial
transactions, alter app state, restart the shared server or contact an application API.
Temporary visual captures remain outside the repository; no user review notes were committed.

## Limits

This verifies that the **review artifact** renders and its controls work. It does not
verify proposed financial mechanics, production KYC, legal agreements, partner integrations,
native wallet extension behavior or public-chain transaction readiness.

Existing signed recordings remain tied to their recorded source and environment.
The acceptance matrix defines the additional proof a future four-persona implementation needs.
No app/contract edits, deployment or public-chain writes occurred in this task.
