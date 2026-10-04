# Local journey cleanup

The journey choice now presents the investor and platform cards without the extra capital/judge prompts. THE EARLY EXIT RAIL was removed from both the journey choice and public overview.

Change journey and the chain read status share one toolbar, at opposite corners. The same read-status component preserves block/time display, refresh, and stale-data handling in the working application. Terms and onboarding retain their existing focused presentation.

## Verification

- Build and lint passed after the final source edit.
- All 42 regular browser tests passed; three opt-in signed-fork cases were skipped.
- Journey choice and public overview inspected at 375, 768, and 1440px.
- Seven toolbar checks covered loaded, refreshing, stale, failed refresh, and investor navigation; zero overflow, overlap, or page/console errors. Navigation and status text centers aligned exactly.
- An unmodified live Sepolia read returned block 315541823 on the investor journey with no page errors. No wallet signatures or transactions were performed in this UI pass.

[Phone](../app/docs/proof/journey-cleanup/loaded-375.png) · [Tablet](../app/docs/proof/journey-cleanup/loaded-768.png) · [Desktop](../app/docs/proof/journey-cleanup/loaded-1440.png) · [Live read](../app/docs/proof/journey-cleanup/live-1440.png)

[Layout observations](../app/docs/proof/journey-cleanup/checks.json) use an explicit wallet/read fixture for deterministic rendering. [Live observations](../app/docs/proof/journey-cleanup/live.json) use unmodified public chain reads and a disconnected wallet. The fixture captures represent layout and controls, not wallet signing or financial outcomes.

Repository: `gabrielantonyxaviour/lockgate-open-house`. Branch: `feat/reui-onboarding-local`. Tested source: `fae2db1613a3db79c7c587cc3408d207703b74e2`. Source/capture hashes are in [integrity.json](../app/docs/proof/journey-cleanup/integrity.json).

Ready for local review at <http://127.0.0.1:5197/>. Deployment waits for Gabriel's request; no deployment, merge, or auto-deploy change was made.
