# Lockgate app verification — 4 October 2026

The reviewed app build is deployed at [openhouse.lockgate.finance](https://openhouse.lockgate.finance) and [open-house.lockgate.finance](https://open-house.lockgate.finance). The two final signed browser suites passed against the same application source as the deployed build. The report distinguishes public read checks, genuine local-fork wallet execution and read-only layout fixtures.

## Deployment evidence

- UI source checkpoint: `da155589d45f820cd50f7ad8ef3741bc16595809`, branch `feat/approved-exit-desk`, pushed and matched against GitHub.
- Cloudflare worker: `lockgate-open-house`; deployed version `08424aa0-3e99-485c-8bc1-7ccf3a29c566`.
- Both public domains served HTTP 200 and the expected `/assets/index-CaKHjc0E.js` bundle.
- Public metrics loaded from Sepolia at blocks 315459048 and 315459100. Reads took 4.3 and 4.3 seconds in this observation.
- Both domains were inspected at 375, 768 and 1440px: no document overflow, clear wallet CTA, no preselected workspace on arrival, and zero browser runtime exceptions.
- Missing-wallet connection showed an actionable error. Selecting Arbitrum One showed the unavailable desk; returning to Sepolia restored live data.
- The live registration page also rendered its actual factory owner and owner-required state with no runtime errors; see `proof/live/create-read-only.png`.
- [Public verification manifest](proof/live/verification.json) and its adjacent screenshots contain the observations. No public contract transaction was sent during verification.

## Changes delivered

Visitors first see the product explanation, live public figures, platform windows and a clear wallet action. Connecting reveals equal investor and platform entry choices. The optional judge walkthrough remains separate from the ordinary entry.

The shared wallet dialog now displays the actual selected account, network, USDG and ETH balances, address copying, explorer access and disconnect. A remembered connection restores already-authorized accounts without requesting permission again. Account changes invalidate old balances and transaction reviews cannot sign with the wrong account or chain. Partner wallets default to their own vault; switching accounts resets that choice. Receipt, request and new-platform screens show a reading state while a fresh snapshot is loading, then offer a refresh action for unavailable records. A cleared late advance shows reserve recovery separately from the missed platform repayment deadline.

Partner capital now has reserve posting, full advance repayment and grace-aware late recovery. The institutional facility now exposes lender approval, senior/junior funding, idle share redemption, paid interest claims, borrower draws, repayments, covenant evaluation and loss recognition. Newly created platforms have a reserve-funding control.

All imported patterns use one radius, type, spacing and control system. Tablet navigation collapses before the sidebar squeezes content; mobile navigation follows the active persona. Entry and onboarding copy is shorter, and the footer is compact. [UX audit](../app/docs/UX_AUDIT.md) documents the Aave, Stripe and retained registry references, visual inspection, and responsive evidence.

## Automated checks

| Check | Result | What it establishes |
| --- | --- | --- |
| App production build and TypeScript | Passed | Integrated code and production bundle compile. |
| App lint and diff checks | Passed | No reported lint errors or whitespace issues. |
| App unit tests | 157 passed, 14 files | Amounts, permissions, deployment boundaries, quote freshness, proposal digests, reverts, unknown confirmations, facility and partner actions. |
| Regular browser suite | 25 passed; three opt-in fork scenarios skipped | Navigation, wallet session states, keyboard controls, drafts, preferences, network switching, RPC failure and preview write blocking. |
| Responsive review | 57 route/width combinations, zero overflow | Nineteen routes at 375, 768 and 1440px; screenshots viewed. Additional live capital/reserve captures are included. |
| Engine suite | 201 passed, one opt-in case skipped | Pricing, proposal and sweep boundaries, schemas and engine behavior. |
| Harness suite | 103 passed | Deployment manifests, isolation, preflight, local console stages and secret hygiene. |
| Foundry contract suite | Passed | Contract behavior including core, partner, facility and fork tests; 388 test cases discovered across 93 suites. |
| Signed browser persona journeys | Both suites passed | 75 browser-signed transactions, 105 signed successful receipts including setup, two engine EIP-712 signatures; six ownership handovers excluded from signed claims. |

The network-switch browser test deliberately aborts its read RPC after switching back to Sepolia. It checks that an outage produces an unavailable state and never substitutes illustrative balances. Public read success is verified separately above.

## Signed proof and recordings

| Run | Browser-signed actions | Other signed setup/deployments | Excluded ownership handovers | Artifacts |
| --- | --- | --- | --- | --- |
| [Main persona lifecycle](proof/wallet/run-1791063405834/manifest.json) | 52: investor 6, issuer 8, operator 16, partner 22 | 16 | 3 | 45 PNGs, 4 persona recordings |
| [Remaining actions](proof/wallet/remaining-1791063297328/manifest.json) | 23: investor 4, operator 6, partner 13 | 14 | 3 | 12 PNGs, 3 persona recordings |

All 111 receipts succeeded; 105 have actual transaction signature fields and chain ID 421614. The other six are explicitly labelled local ownership handovers, not signed browser actions. The main run also records two actual engine EIP-712 signatures accepted by the vault. No public contract write occurred.

The investor early exit paid 0.49525 USDG. Its refreshed receipt later showed **Repaid**, 0.00 USDG remaining and 0.50 USDG recovered/repaid. The separate queued early exit and late path recovered 0.50 USDG from the source reserve, showed **Recovered**, and kept the missed platform repayment step incomplete. Contract reads and displayed values are checked before capture.

Remaining actions include partner pause/unpause, zero-limit platform revocation and reapproval, facility lender revocation with deposits denied, positive senior capital deposit during recovery with junior deposits denied, and actual epoch/quarterly platform creation. Main coverage includes issuer eligibility/gating, actual settlement, registration/reserve funding, partner authorization/repayment, both facility tranches, draw/repay, paid interest claims, idle share redemption and positive loss recognition.

Both retained runs have zero runtime, console and cleanup errors. All 64 image/video hashes were independently checked; all seven recordings fully decoded through FFmpeg. [Integrity results](proof/integrity.json) verify every source file and the shared source-tree digest `7c594d66367d8edaca807b468c68d1541e8662adf634a6b7816ad61ae02dee03`. Supplemental source was captured before its Activity patch was committed; its recorded dirty path and per-file hashes match the final committed source exactly. Main provenance records the clean deployed source checkpoint.

Review all recordings and screenshots in the [local proof gallery](proof/index.html). These are raw browser journey recordings rather than an edited narrated submission film. Older diagnostic runs are preserved locally and are excluded from the selected gallery and GitHub proof checkpoint.

## Journey coverage

| Persona / screen | Intended operation | Evidence lane |
| --- | --- | --- |
| Public entry, choice, journey pages | Understand the rail, inspect public figures, connect, choose a role without forced onboarding | Public deployed checks; entry browser tests; responsive images. |
| Wallet and settings | Address, token/gas balances, network, restored session, account changes, rejection, disconnect, display preferences | Wallet-session browser tests; signed rejection, wrong-chain/account-change guards, balance view, restoration and disconnect. |
| Platforms, positions, exit, receipt | Deposit owned shares, queue, cancel, quote an early exit, receive USDG, inspect obligations and settlement | Contract/unit tests; genuine signed browser transactions and contract-state assertions. |
| Issuer | NAV, gate, wallet eligibility, settlement cash, process the due window | Contract/unit tests; genuine signed browser transactions and contract-state assertions. |
| Operator and registration | Capital in/out, caps, grace, source terms, create an actual platform, post reserve | Contract/unit tests; genuine signed browser transactions and contract-state assertions. |
| Partner capital and approvals | Capital in/out, mandate and platform terms, reserve, engine proposal verification, wallet authorization, repayment and late recovery | Contract/unit tests; genuine signed browser transactions and contract-state assertions. |
| Institutional facility | Lender approval, both tranches, draw, repay, claim interest, redeem idle principal, recovery and loss waterfall | Contract/unit tests; genuine signed browser transactions and contract-state assertions. |
| Activity | Recent events from all registered platforms and facility, partial-source warnings | Event unit tests; responsive inspection and signed journey snapshots. |
| Onboarding | Validate, save, restore and export the local commercial/integration plan | Browser and draft unit tests. |
| Integration, help and judge guide | Correct addresses, responsibility boundaries, wallet/role/balance readiness and accessible navigation | Browser, readiness unit tests and visual inspection. |

## Scope and practical limits

The public chain still has its real balances and permissions. Partner vaults and the institutional facility were unfunded when observed. A connected visitor needs Sepolia gas, actual USDG or existing shares, and the applicable issuer/owner/lender permission. Choosing a workspace does not grant authority.

Arbitrum One wallet switching works, but there is no One contract deployment. Platform onboarding saves and exports a local draft; it does not submit an application or complete legal review. Partner proposal delivery remains manual engine JSON import. Histories are bounded and are not an indexed long-term analytics service. Browser signing proof covers weekly settlement and creation of all three queue types; epoch/quarterly settlement mechanics are covered by contract tests, not separate browser recordings. Open-vault adapter purchases/settlement are also outside the recorded browser journeys. Positive signed partner flows use vault A; vault B ownership selection and form reset are verified as read-only account-switch checks. Governance upgrades and timelocked administration outside the app's transaction inventory are not represented as completed app features.

The signed test uses a local EIP1193 adapter with disposable signing accounts and actual contract execution. It does not test a browser extension's own popup. Setup ownership handovers are distinct from signed user actions. The facility's fixed public borrower cannot be replaced for testing; the fixture genuinely deploys the same compiled contract artifact locally with known disposable borrower/governor keys. Its constructor values and bytecode hashes accompany the receipt manifests.

## Demo preparation and recording order

The deployed original platform's October 2 window is overdue. Processing one window can leave other missed windows due. For a clean new demonstration, the authorized factory owner should create a platform with a future window and fund its real source reserve before the investor requests an early exit. Public contract state was not reset or funded by this verification pass.

Record the sequence shown by the signed journeys: public arrival → connected wallet balances → investor deposit, queued request/cancel and quote → early-exit receipt → issuer NAV/eligibility/settlement cash → process the window → cleared obligation. Then show operator capital/limits/registration, partner mandate/reserve/proposal authorization/repayment, and facility senior/junior capital, draw/repay/interest and recovery. Separate late reserve recovery from on-time platform repayment.

Use the wallet authorized for each role. Investor USDG, issuer settlement USDG, source reserves, partner capital, facility lender approval and Sepolia gas are prerequisites, not permissions granted by selecting a workspace. The judge guide reads these prerequisites and links to each step. The local videos document actual signing and contract execution in an isolated fork; recording a fresh public testnet demonstration still requires funded authorized wallets.

## Reproduce

From `repo/app`, run `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e`. Run the signed scenarios sequentially with `LOCKGATE_SIGNED_FORK_TEST=1 npm run test:e2e -- test/signed-wallet-flow.spec.ts test/signed-remaining-flow.spec.ts --workers=1`. It requires Anvil and an archive-capable Sepolia upstream; it refuses to reuse occupied port 19548.

After deploying the built UI, `node test/check-live.mjs` verifies both existing domains and records the result. From `repo`, `python3 scripts/build-app-proof.py --run run-1791063405834 --run remaining-1791063297328` rebuilds the [local proof gallery](proof/index.html) using only the selected completed signed manifests. `python3 scripts/check-app-proof.py --run run-1791063405834 --run remaining-1791063297328` independently verifies artifacts, receipts and current source hashes.
