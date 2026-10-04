# Lockgate local demo test report

**Result:** Five ordered Playwright specs passed against one fresh local Anvil fixture on 2026-10-04, 10:55–10:56 UTC. This is local TEST evidence, using a six-decimal MockUSDG ERC-20 on chain ID 421614 at `127.0.0.1:8545` and the local demo API at `127.0.0.1:8788`. It is not a public Arbitrum Sepolia transaction, a Paxos USDG transfer, production KYC, an institutional approval, or a finished demo film.

The fixture started at block 167 with five active originators, five active firms, five vaults holding 500,000 TEST USDG each, 20% originator NAV caps, 2,500,000 TEST USDG total available cash, zero outstanding exposure, and ten unbound UI identities. The public manifest SHA-256 was `9787d6a259729706c306e3880ac815f20123104d5b9ed8eac2c0c4f37d57c27c` for every run. The full source hash inventory is separately maintained in `proof/demo/final-source-manifest.json`; each evidence JSON also records hashes of its tested files.

| Ordered test | Result | Final evidence | Size on disk |
| --- | --- | --- | ---: |
| Four personas, permissions, queue | Passed, 18.3 s | [main evidence](./proof/demo/run-1791111333584/evidence.json) | 6.1 MiB |
| Route-A claim collection and return | Passed, 4.1 s | [collection evidence](./proof/demo/run-1791111356166/collection-evidence.json) | 856 KiB |
| Birch full-claim reservation replacement | Passed, 4.6 s | [Birch evidence](./proof/demo/run-1791111364083/birch-evidence.json) | 684 KiB |
| Fresh capital-provider wallet | Passed, 3.1 s | [retail evidence](./proof/demo/run-1791111371962/retail-evidence.json) | 844 KiB |
| API boundary and durable enquiry | Passed, 0.57 s | [API evidence](./proof/demo/run-1791111379343/api-boundary-evidence.json) | 4 KiB |

The browser harness injected only an EIP-1193 wallet provider. Its disposable mnemonic-derived local accounts produced real `personal_sign` and EIP-712 signatures. For `eth_sendTransaction`, the harness signed the transaction locally, broadcast its raw bytes to Anvil, and checked its mined receipt, sender, and chain ID. API responses, balances, positions, firm authority, KYC bindings, and settlement state came from the running service and contracts. No wallet extension popup was captured or claimed.

The main journey verified five on-chain active originators and five funded firms, eight seeded holding registrations, investor profile 9's ownership-mismatch offer denial (403), and profile 10's empty state. Seeded capital-provider signer 11 already owned a 500,000-unit firm interest before choosing the fictional Priya profile in the UI. She rejected one real provider signing request with code 4001, then signed an exact 1,000 TEST USDG subscription, reloaded, resumed the accepted subscription without another signature, funded it, and saw the same amount require new terms for a later addition. Her book units rose from 500,000 to 501,000. This seeded account exercised a 100 immediate withdrawal, a 470,000-unit queue, manager processing, a 461,700 TEST USDG wallet claim, and cancellation of the 8,300-unit unfilled remainder without a second book burn.

Investor signer 2 received 39,200 TEST USDG for a 40,000-unit route-A purchase; her holding fell from 100,000 to 60,000. She then signed a distinct route-B financing exit; the originator's 19,686 TEST USDG repayment cleared that obligation. Originator signer 1 also registered a 500-unit holding through the approved organization workspace. Firm signer 6 changed Alder's live mandate and processed the withdrawal queue. The test checked malformed role 400, forged manager and identity actions 403, unauthenticated state 401, cross-account receipt 403, wrong network and account changes, and investor reload/resume. All 18 main wallet transactions were mined successfully.

The collection test used the same originator wallet to repay the outstanding route-A obligation at its exact 40,000 TEST USDG face value. On-chain `purchasedUnits` fell from 40,000 to zero, `collectedUnits` rose from zero to 40,000, vault principal fell by 39,200, and vault assets rose from 39,200 to 40,000. The observed 800 TEST USDG spread appeared in the seeded provider's ledger income. This is local contract accounting, not a promised investment return.

The Birch test used an indivisible 100,000-unit holding. A first signed bid was reserved, then cancelled on-chain when a second signed bid was selected; the second deal settled the entire holding and transferred 97,000 TEST USDG to the investor. The separate fresh-wallet test used disposable signer 31, which started with zero ETH, zero TEST USDG, and zero firm book units. It obtained local faucet gas and MockUSDG, bound fictional Hana Kim through a wallet transaction, signed exact firm terms, and funded 1,000 TEST USDG. The resulting **980 book units** reflect live vault NAV after the earlier transactions; this is a different actor from seeded signer 11 and must not be presented as one continuous account.

The API test rejected replay of a consumed wallet challenge (401), kept signer 12's firm-1 book at zero while exposing only its own firm-2 500,000-unit interest, derived the receipt title and amount from the actual transaction despite submitted forged values, allowed profile 9 to prepare provider terms without exposing the mismatched investor holding, rejected invalid enquiry input, and preserved one enquiry reference and timestamp across an idempotent replay. The conflict returned 409. The locally queued acknowledgement HTML escaped the submitted script text. Its email status was **“Queued — verified Lockgate email sender required”**; no delivery claim was made.

Run each command below from `repo/app`, in this order, after a coordinated fresh local seed. All five commands returned exit code 0. The opt-in flags prevent these tests from mutating an ordinary test run.

```sh
LOCKGATE_DEMO_E2E=1 npx playwright test test/demo-signed-flow.spec.ts --project=chromium --workers=1
LOCKGATE_DEMO_COLLECTION=1 npx playwright test test/demo-collection.spec.ts --project=chromium --workers=1
LOCKGATE_DEMO_BIRCH=1 npx playwright test test/demo-birch.spec.ts --project=chromium --workers=1
LOCKGATE_DEMO_RETAIL=1 npx playwright test test/demo-retail.spec.ts --project=chromium --workers=1
LOCKGATE_DEMO_API=1 npx playwright test test/demo-api.spec.ts --project=chromium --workers=1
```

The final evidence contains **25 locally signed, mined wallet transactions**, **21 full-page screenshots** at 375, 768, and 1440 pixels, and **nine unedited browser WebM recordings**. The main folder has six standalone persona recordings (`mismatch`, `empty`, `provider`, `investor`, `originator`, `manager`); collection, Birch, and the fresh provider each add one. Their exact SHA-256 values are stored beside screenshots and transaction proof in the evidence JSON. A post-run check recomputed every media hash, found no duplicate `page@*.webm` source recording in these final folders, and visually inspected narrow, medium, and wide captures. The fresh-wallet history correctly shows the local gas grant as `0.01 ETH`, rather than `NaN USDG`.

The evidence JSON files themselves have SHA-256 hashes, in run order: `ee34fb090cb9546b28d6c7cdf127d8cb5629b861f446f21762ec194890bf6234`, `003a0515a9c14fbf24df3382f69ea8a4d24887a9e4fc7ecf8982946394a78668`, `df3b7247b221398bf80bc66f5c59c70c68e1303f17b658c680d8c1e3f7f9bbe3`, `b44a2f933ba06b2c6b195531ffd7b5d1281e57c38a6c4f3e56bbbde37b686c59`, and `d98fb8598b75e7009ee380f1ca0e9146463a84bf90713e5ad23d01f9927ee57c`.

These clips prove the tested local journeys and responsive screens. They do not constitute Gabriel's final narrated recording or validate external email delivery, a public chain deployment, a live issuer, or a production asset.
