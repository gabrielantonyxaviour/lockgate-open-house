# Lockgate interface review — 4 October 2026

The existing monochrome identity remains. The review focused on readable financial decisions, a usable tablet layout, clear wallet access, and completing capital operations in the existing workspace.

## Reference patterns inspected

| Source | Observed pattern | Lockgate application |
| --- | --- | --- |
| [Aave markets](https://app.aave.com/) | Persistent wallet control, one market context, summary above searchable records. Public page inspected visually; data was still loading in the capture. | Keep network and wallet together, retain stable summary/record hierarchy, and avoid wrapping header controls on tablets. |
| [Aave withdrawal guide](https://aave.com/help/supplying/withdraw-tokens) | Connect, choose a held position, enter an amount, and confirm in the wallet; availability depends on liquidity. | Preserve position-first navigation, explicit amount units, available cash, and a separate review before signing. |
| [Stripe Dashboard search](https://docs.stripe.com/dashboard/search) | Search provides direct access to important resources and detail views. | Retain keyboard screen search and contextual navigation; verify Escape and focus restoration. This is a documentation reference, not a signed-in Stripe Dashboard inspection. |

These are interaction references, not claims that their products share Lockgate’s credit mechanics. No competitor artwork, code, or branding was copied.

## Changes

| Before | After | Why |
| --- | --- | --- |
| Journey and onboarding headings dominated the working area. | Scoped 32px desktop/tablet and 28px phone headings, shorter journey titles, and less repeated introductory content. | Keep wallet connection and the next task visible. |
| Explore platform terms entered the application dashboard. | Public, standalone terms list/detail with read-only data, refresh, and a return link preserving investor or issuer origin. | Let visitors inspect terms without entering a workspace. |
| The issuer introduction exposed a local facility draft link before connection. | Connect first, then start platform onboarding; existing issuers keep their workspace shortcut. | Put planning inside the appropriate platform journey. |
| Connected onboarding inherited the dashboard shell. | Standalone entry shell, compact step navigation and form spacing; local validation/save/export retained. | Keep attention on preparing the facility plan. |
| Sidebar persisted at 768px; long breadcrumbs wrapped wallet controls and squeezed table actions. | Drawer navigation applies through 960px; wallet/network controls stay on one row. | Preserve working content width on tablets. |
| Mobile navigation always showed investor links. | Contextual issuer, operations, or partner links on the relevant workspace. | Keep the current persona’s daily actions in reach. |
| Entry copy repeated the same product explanation across multiple screens. | Shorter public, role-choice, and journey copy. | Put the next decision ahead of repeated explanation. |
| Integration prose used browser-default line spacing; mobile contract rows lacked labels. | Consistent paragraph rhythm, mobile row headers, and explicit role/address labels. | Make technical reference content readable at phone width. |
| Onboarding step labels disappeared into horizontal scrolling. | Steps wrap on phones; active step has a quiet filled background. | Keep progress and reachable steps visible. |
| Checklist badges and descriptions wrapped inconsistently. | Fixed badge column with a flexible text column. | Keep validation messages aligned. |
| Explicit illustrative public preview called its figures on-chain balances. | Preview-specific source wording; normal chain mode retains block/read information. | Keep evidence provenance accurate. |
| Public redemption gating was labelled permissioned/open access. | Redemptions paused/open. | Avoid confusing a redemption gate with wallet eligibility. |
| Institutional facility was a contract-reference placeholder. | Senior/junior deposit, share redemption, interest claims, borrower draw/repay, lender approval, and recovery actions. | Expose the deployed facility with role and liquidity checks. |
| Partner reserves and advance repayment lacked UI controls. | Platform reserve funding, exact owed repayment, and grace-aware late marking. | Complete the partner advance lifecycle. |
| Capital initially selected vault A for every wallet; vault-control keys collided on switching. | Default to the connected owner’s vault, preserve its explicit choice until an account change, and use distinct keys for controls and operations. | Partner B opens its own vault and switching cannot retain duplicate stale forms. |
| Credit limit configuration rejected zero. | Zero is permitted for facility limit configuration; transfer amounts remain positive. Vault controls reset when changing vault. | Allow a zero-capacity configuration without stale mandate values. |
| A balance cleared through reserve recovery also marked platform settlement complete. | Late receipts retain an uncompleted platform repayment step with the missed-deadline explanation; reserve recovery and balance clearance keep their own states. | Distinguish recovery from normal platform repayment. |
| Opening a newly confirmed receipt or platform could briefly report it missing while the next snapshot loaded. | Receipt, platform and redemption-request views show a reading status during refresh, then a clear retry action for a missing record or failed read. | Keep confirmation-to-detail navigation accurate during asynchronous chain reads. |
| Header wallet button only navigated to settings. | Shared wallet dialog integrated in both entry and application shells. | Address, balances, network, copy, explorer and disconnect stay close to the account control. Wallet dialog implementation belongs to the coordinator. |

Control radius stays 8px; panels and financial summary groups use 12px; badges remain pills. Existing official Arbitrum, USDG and Paxos assets are retained. No native selects were introduced.

## Evidence

- [Entry refinement checks](proof/entry-refinement/visual-checks.json): eight surfaces at 375/768/1440px, plus [real public terms reads](proof/entry-refinement/public-terms-checks.json) at the same widths. Six explicit loading/error/empty/missing states are recorded in [state checks](proof/entry-refinement/state-checks.json). The coordinator's final suite passed 157 unit tests and 34 regular browser tests, including standalone connected terms, direct-link reload/return, RPC-failure onboarding access, draft validation and save/export. Current deployment checks are recorded in [the entry verification report](../../docs/ONBOARDING_UX_VERIFICATION.md).
- [Responsive matrix](proof/ux/responsive.json): 19 routes at 375, 768 and 1440px; all 57 checks returned zero document overflow. Full-page PNGs are in `proof/ux/` and were inspected at all three widths.
- Read-only public Sepolia facility was rendered at all three widths: `capital-live-375.png`, `capital-live-768.png`, `capital-live-1440.png`. The empty facility balances in these captures are live read results, not funded-journey proof.
- [Partner owner selection checks](proof/ux/partner-owner-selection.json) passed at 375/768/1440px using an explicit two-owner illustrative fixture: B defaults to B, explicit choices persist for the current account, A/B account changes reset the choice, form values reset, exactly one controls form remains, and no console errors, page errors or document overflow were observed. Screenshots: `partner-owner-b-{375,768,1440}.png`.
- The platform Overview includes **Post platform reserve**, using the existing permissionless funded-wallet contract call. Its amount field and disabled preview action were inspected at all three widths (`platform-reserve-{375,768,1440}.png`).
- Senior-to-junior selection was exercised in the live read-only facility. The capital screen was recaptured after the final partner operations addition.
- The 23-test UI/entry regression suite passed after the capital UI additions. It covers navigation, mobile drawer focus, custom selects, reduced motion, onboarding validation/export, preferences, preview transaction blocking, and network switching/rejection.
- [Receipt timeline checks](proof/ux/timeline-states.json): recovered and normally repaid records passed at 375/768/1440px, with zero console/page errors and overflow. Recovered state used an explicit fixture; normal repaid state used the existing preview record. Visually inspected recovered screenshots at all three widths and repaid at desktop.
- [Read-state checks](proof/ux/read-states.json): 12 checks across receipt, platform, exit-platform and redemption-request views at 375/768/1440px. Explicit delayed-read fixtures exercised loading → missing → failed read → refresh → record restored, with no console/page errors or overflow. The unmodified missing-receipt route and its refresh action also passed. Loading screenshots were viewed at phone, tablet and desktop widths (`read-*-{375,768,1440}.png`). Typecheck and lint passed after the final page edits. The coordinator runs the final full browser suite; the earlier 23-test count above describes the prior UX checkpoint.
- Wallet signing, funded balances, role permissions, receipts and recovery outcomes belong to the separate signed-fork test lane; consult its final result. Preview screenshots do not prove those transactions.

## Boundaries

Screenshots use explicit illustrative preview except files named `*-live-*`. The production application does not default to preview. Local rendering and tests do not prove a deployment. Only the light theme exists. Public Aave visual inspection was disconnected; Stripe was reviewed through official documentation. The proposed partner feed still requires importing the engine payload; this review did not create an automatic feed.
