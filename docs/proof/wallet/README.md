# Signed wallet proof

This harness runs the browser application against a disposable Anvil fork of Arbitrum Sepolia on **127.0.0.1:19548**. The injected EIP-1193 wallet signs each browser-requested transaction locally, serializes it, and submits it through `eth_sendRawTransaction` to that fork. It does not forward transaction writes to a public RPC.

The persona mnemonic is Anvil's public disposable fixture mnemonic. The engine uses an explicitly public deterministic seed because common Anvil addresses carry existing EIP-7702 delegation code on Sepolia; the harness verifies the engine signer has no code. These are not personal wallets. This verifies actual EVM execution and local account signatures, not a browser-extension wallet's own popup or public testnet execution.

Run from `repo/app` with the existing Vite server at `http://127.0.0.1:5197`:

```sh
LOCKGATE_SIGNED_FORK_TEST=1 npx playwright test test/signed-wallet-flow.spec.ts --workers=1
```

Anvil and Playwright Chromium must be installed. Port 19548 must be free. The harness refuses to share an occupied fork port and closes only the Anvil process it creates.

## Scope

- Investor: wallet connection, balance view, reload restoration, rejected approval, wrong chain, deposit, redemption request, cancellation, another queued request, early exit, settlement, account-change protection, disconnect.
- Issuer: NAV update, gate and ungate, investor block/allow, settlement cash, processing settlement.
- Operator: own-book capital deposit/withdrawal, risk caps, grace, platform terms, pause/unpause, investor denial for owner controls, platform creation and reserve posting.
- Partner: vault deposit/withdrawal, mandate, platform terms, reserve posting, importing and authorizing engine-signed EIP-712 proposals, repayment closure and overdue reserve recovery.
- Facility: governor lender admission, senior/junior deposits, unapproved-lender denial, borrower draw, health update, repayment, both interest claims and share redemption, recovery and positive losses after the actual borrowing base disappears at settlement.

The deployed facility borrower cannot be transferred to a fixture account. For this flow, the harness deploys the same local Foundry `CreditFacility` artifact with public fixture accounts as governor/borrower, then maps only the facility address in the test-served config module. Every other contract remains the forked deployment. The manifest identifies the replacement address, constructor arguments, transaction, creation/runtime bytecode hashes and fork checkpoint. It does **not** verify the original public facility borrower.

Impersonation is restricted to transferring existing contract ownership on the local fork. Subsequent fixture setup and browser writes are signed by public fixture accounts. Ownership handover receipts are explicitly excluded from signed-flow claims. No storage or code override is used.

## Artifacts

Each run has a separate `run-<timestamp>/` directory containing:

- `manifest.json`: `completed` indicates whether all assertions passed; receipts, signatures, fixture metadata, balances, snapshot latency, runtime errors, console errors, cleanup errors, transaction nonces/signature fields and artifact SHA-256 hashes.
- Screenshots at 390, 768 and 1440 pixels, captured at meaningful confirmed states.
- One named browser video per persona context (`investor.webm`, `issuer.webm`, `operator.webm`, `partner.webm`), covering the user journey.

Earlier diagnostic runs are retained as evidence and must not be presented as completed verification. An interrupted run can have no manifest. Use only a manifest with `completed: true` for an all-persona success claim.

The engine proposal is filed as a signed fixture, then verified by the app and authorized by the partner transaction. An automatic production proposal feed, issuer integrations, licensed-partner approval, real USDG and mainnet operation remain outside this local proof.

## Coverage boundaries

The main suite covers the persona lifecycle. The separate signed-remaining-flow.spec.ts suite covers an already queued early exit, own-book late reserve recovery, partner pause/unpause and zero-limit platform revocation/reapproval, lender revocation with deposit denial, senior recapitalization during recovery with junior deposits denied, and actual epoch/quarterly platform creation. Queue settlement behavior for every queue type and open-vault adapter purchases/settlement remain outside this browser proof. Partner B account switching is read-only; signed positive vault flows use partner A. Transaction rejection and wrong-chain/account-change guards assert no extra receipts.

Run both suites sequentially on the owned fork port:

```sh
LOCKGATE_SIGNED_FORK_TEST=1 npx playwright test test/signed-wallet-flow.spec.ts test/signed-remaining-flow.spec.ts --workers=1
```

Final manifests contain git HEAD, dirty source paths, per-source hashes and a sorted source-tree digest. Before screenshots, the harness refreshes and verifies that the displayed snapshot block reaches the actual local fork block; advance detail screenshots also require the expected remaining obligation.

## Final verified evidence

Use these two completed runs, which share the final source-tree SHA-256 `7c594d66367d8edaca807b468c68d1541e8662adf634a6b7816ad61ae02dee03`:

- [Main persona lifecycle](run-1791063405834/manifest.json): 71 successful receipts, including 52 browser-signed transactions, 16 signed setup/deployment transactions and 3 explicitly impersonated ownership handovers; two engine EIP-712 signatures. 45 screenshots and four named videos.
- [Remaining UI actions](remaining-1791063297328/manifest.json): 40 successful receipts, including 23 browser-signed transactions, 14 signed setup/deployment transactions and 3 explicitly impersonated ownership handovers. 12 screenshots and three named videos.

Both suites passed sequentially after the final Activity timeline change. Runtime, console and cleanup errors are empty. Every artifact hash was checked and every video fully decoded with FFmpeg without errors. Funded, repaid and recovered advance screenshots were inspected against the expected remaining obligation. Earlier runs remain diagnostic/historical evidence and are not selected for the final gallery.
