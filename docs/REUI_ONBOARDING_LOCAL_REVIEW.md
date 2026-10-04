# Local ReUI onboarding review

The selected [`@reui/onboarding-8`](https://reui.io/blocks/application/onboarding/onboarding-8) layout is adapted to Lockgate's existing light design system. This change is local and on the review branch. Production has not been updated.

[Open the local layout](http://127.0.0.1:5197/?preview=1#/onboarding) · [Open the wallet-gated journey](http://127.0.0.1:5197/#/onboarding) · [Browse all captures](../app/docs/proof/reui-onboarding/index.html)

## Result

The form is centered in a narrow frame with subtle corner markers, a slim progress indicator, and persistent Back, Save draft, and Continue controls. Headings are 28px on desktop/tablet and 26px on phones. The five facility steps remain Platform details, Facility terms, Reserve plan, Integration, and Review your plan. The exported-plan completion state allows review and export again.

Lockgate's existing validation, draft storage format, JSON export, wallet gate, official brand assets, and control radii are preserved. Invalid fields show their errors and receive focus. Enter advances a valid stage, progress navigation cannot bypass invalid dependencies, and a failed browser save keeps the entered fields editable.

The registry block was retrieved with the existing license credential and inspected alongside its rendered public preview. The CLI dry-run resolved 38 files, eight dependencies, and 18 CSS variables. Its form/progress/action layout was adapted into the existing CSS and Radix components. The generic profile, invitations, AI, and CLI workflow was not added to Lockgate. No application dependencies or configuration were changed; the raw licensed registry bundle and credential are excluded from the repository. [Registry provenance](../app/docs/proof/reui-onboarding/reference.json)

## Verification after the final source edit

| Check | Result |
| --- | --- |
| Production build and lint | Passed locally |
| Unit suite | 157 passed across 14 files |
| Browser suite | 42 passed; three opt-in signed-fork cases skipped |
| Responsive visual review | All five stages, completion, and disconnected gate at 375, 768, and 1440px; 21 captures |
| Layout/error observations | Zero document overflow, console errors, or page errors in the visual matrix |
| Short viewport actions | Save draft and Continue visible at all three widths with a 640px viewport height |
| Validation and keyboard | Invalid-field handling, Enter progression, heading focus, and dependency gating passed |
| Persistence failures | Save/restore/clear and browser storage quota failure passed |
| Export | Actual JSON download name and payload checked; zero POST requests; editable completion passed |

Commands: `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` from `app/`. The eight added browser tests are in [reui-onboarding.spec.ts](../app/test/reui-onboarding.spec.ts). [Visual observations](../app/docs/proof/reui-onboarding/visual-checks.json) and [source/capture integrity](../app/docs/proof/reui-onboarding/integrity.json) accompany the gallery.

## Review and deployment boundary

Repository: `gabrielantonyxaviour/lockgate-open-house`. Review branch: `feat/reui-onboarding-local`. Tested source checkpoint: `17f22223d39f57b06c0ad5ee3f06d14f47dd8a7b`.

Both public hosts returned HTTP 200 with the previous `index-E-gtT276.js` bundle. The local build's `index-BD8UExBY.js` bundle was absent from their HTML. [Read-only production boundary check](../app/docs/proof/reui-onboarding/production-boundary.json)

Captures of the form use the explicit illustrative layout preview and a local sample facility plan. The disconnected gate uses normal mode. These checks prove this onboarding UI and its local draft behavior; they do not represent a submitted application or an activated facility. No signing or transaction behavior was changed or retested in this pass. Native wallet extension popups and physical mobile keyboards were not exercised. Earlier signed-flow evidence remains pinned to its original source checkpoint.

The local preview is ready for Gabriel's visual review. Deployment remains pending an explicit request; no deployment, merge, or auto-deploy enablement was performed.
