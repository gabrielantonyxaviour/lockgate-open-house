# App chain integration audit

Audit scope: the wallet app in `app/src/chain`, its actual contract targets, and transaction boundaries. This document does not claim legal clearance, a production deployment, or a funded public partner facility.

## Findings fixed

| Finding | Change | Verification |
|---|---|---|
| An earlier selected wallet remained accepted if it appeared later in `eth_accounts`. | Require the first selected account to match the reviewed account before writing. | `chain-wallet-events.test.ts` selected-account regression. |
| The senior/junior facility was deployed but had no app reads or transaction actions. | Added real facility ABI, block-consistent balances, borrowing capacity, lender permissions, paid interest claims, and transaction actions. | `facility-boundaries.test.ts`; deployed read described below. Signed fork verification is owned by the integration suite. |
| Partner proposals could fund, but the app lacked reserve posting and advance repayment/late actions. | Added exact reserve/repayment approvals and permissionless actions matching `PartnerVault`. Read the grace snapshotted at advance funding; compare against the observed chain timestamp, not the browser clock. | `partner-operations.test.ts`; original transaction failure tests remain passing. |
| Recent activity omitted platforms created after the configured original platform. | Discover the credit line's source list at the event range's end block; read each platform plus the facility. | `chain-events-read.test.ts`; partial discovery is reported as incomplete. |
| Setting a source or vault limit to zero was rejected as a zero token transfer. | Separate nonnegative configuration amounts from positive cash movements. | `chain-boundaries.test.ts`; UI limit validators updated by the UI owner. |
| One unreadable registered platform could prevent all positions from loading. | Isolate platform failures and retain explicit per-address warnings. Facility/vault failures also remain optional. | `chain-snapshot.test.ts`. |
| The app snapshot lacked native gas balances. | Read the connected wallet's ETH balance at the same block as its token and contract state. | `chain-snapshot.test.ts` and deployed read. |

## Transaction inventory

All actions use the common `sendAction` path: runtime input schema, matching live wallet snapshot, deployment-chain check, applicable role/amount checks, exact token allowance where needed, contract simulation, selected-wallet/network verification, wallet transaction, receipt status. A missing receipt preserves the hash and reports confirmation as unverified. Public contract permissions remain authoritative even if a snapshot becomes stale.

| App operation | Actual target/function | Authority and units |
|---|---|---|
| Create platform | Factory `createPlatform` | Actual factory owner re-read before signing; supported kinds 1/2/3. No token seeding implied. |
| Investor deposit | Platform `deposit` | Wallet deposits USDG, six decimals. Exact USDG allowance. Issuer deposit block checked. |
| Queue redemption | Platform `requestRedeem` | Wallet's existing shares, eighteen decimals. No share-token approval. |
| Exit immediately / queued exit | Platform `exitNow` / `exitEarly` | Fresh quote and minimum USDG received. Existing queued request must belong to wallet. |
| Cancel request | Platform `cancel` | Wallet-owned queued request only. |
| Fund settlement cash | Platform `depositCash` | Any payer; exact USDG allowance. Does not mint investor shares. |
| Process settlement | Platform `processWindow` | Permissionless at the window. Insufficient cash can prevent the clock rolling. |
| Platform NAV, gate, eligibility | `setNav`, `setGated`, `setAllowlist` | Platform issuer. NAV positive; amounts exact. |
| Source limits / registration | Credit line `setSourceTerms`, `registerSource` | App requires line owner; contract also supports designated registrars for registration. |
| Credit-line capital | `depositCapital`, `withdrawCapital` | Line owner; deposits use exact USDG allowance; withdrawal simulation checks free equity. |
| Credit-line controls | `setCaps`, `setGrace`, `pause`, `unpause` | Line owner. |
| Source reserve | Credit line `postReserve` | Any payer; reserve recorded for selected source. |
| Credit-line late advance | `markLate` | Permissionless active advance, after snapshotted grace. |
| Partner capital | Vault `deposit`, `withdraw` | Partner owner. Withdrawals limited to idle cash. |
| Partner controls | `setMandate`, `setPlatform`, `setPaused` | Partner owner. |
| Partner reserve | Vault `postReserve` | Any payer, approved platform only. Reserve belongs to the platform's reserve account, not partner shares. |
| Partner repayment | Vault `repay` | Any payer of the full outstanding `owed` amount; active or late advances. Exact approval from current snapshot; simulation checks current obligation. |
| Partner late advance | Vault `markLate` | Permissionless active advance after its stored grace; applies reserve to remaining obligation. |
| Proposal funding | Vault `approve` | Owner or designated partner signer; exact engine digest must already be filed, nonce unused, current mandate passes. |
| Approve facility lender | Facility `approveLender` | Facility governor, distinct from borrower. |
| Facility capital deposit | `deposit` | Approved lender, senior=0/junior=1; six-decimal USDG. Junior deposits blocked in recovery. |
| Facility share redemption | `redeem` | Wallet's own tranche shares, **six decimals**, unlike platform shares. Cannot exceed tranche idle principal; senior-first recovery restrictions apply. |
| Claim facility interest | `withdrawInterest` | Wallet's paid, claimable interest. Includes index credits not yet settled to the wallet; excludes unpaid interest due. |
| Facility draw | `draw` | Borrower only, inside current borrowing base and available cash; disabled in recovery. |
| Facility repayment | `repay` | Any payer; exact USDG approval. Contract applies senior/junior waterfall. |
| Check facility covenants | `poke` | Permissionless. Accrues interest and may enter recovery; it is not a harmless read. |
| Recognize facility loss | `recognizeLoss` | Permissionless after recovery; contract computes uncovered loss. |

## Proposal signing distinction

The app's funding authorization is an ordinary wallet-signed `approve(proposal)` transaction. It does not request a redundant EIP-712 partner signature. The contract supports this path after `submitProposal` verifies the engine's EIP-712 signature. The alternative `execute(proposal, engineSig, partnerSig)` path is a separate contract capability, not the app workflow audited here. Imported JSON does not file an engine proposal or constitute a signature.

## Deployed read observation

A read-only `loadSnapshot` against the configured public Arbitrum Sepolia RPC succeeded at block **315444156**, timestamp **1791059745**. No public transaction was sent.

- USDG: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, the configured six-decimal Paxos testnet token.
- Configured credit line and original platform loaded; the platform remained registered.
- Both partner vaults loaded, each with **zero idle cash and zero advances**.
- Facility `0x051Aca84903701E93AA387d6Dd554aF79D640e60` loaded with the configured USDG asset and `CreditLineBook` receivables contract.
- Facility governor `0x55b1342f7e9E3f2630eA1f548577fA7D5124d7af`; borrower `0xc37f3cC9C57F647212894a262F27fA21A371a752`.
- Facility cash, drawn principal, senior/junior principal, lender count, borrowing base and available draw were all **zero**; `solvent()` returned true and recovery false.
- Native ETH and USDG balances were read for the borrower at that same block. Possession or authority over that wallet was not inferred from public reads.

An unfunded public facility remains unfunded after this work. Isolated local-fork funding tests do not alter that observation.

## Validation and limits

- App unit tests: **157 passed, 14 files**, after the final chain changes; includes prior transaction/reverted-receipt/unknown-confirmation/quote-expiry tests.
- App lint: passed after chain changes.
- `git diff --check`: passed during review.
- App typecheck and production Vite build passed after the final chain changes and UI integration available at that point.
- The independent signed local-fork suite exercises actual deployed bytecode, wallet signatures and receipts. Consult its final run result rather than treating these unit fixtures as on-chain transaction proof.
- No contract source changed; no new contract deployment, public wallet write, or mainnet transaction occurred in this audit.
- Arbitrum One can be selected/switched in the wallet, but `contractsAvailable` remains false. All app contract writes remain restricted to the existing Sepolia deployment.
- Proposal delivery remains manual import; the app cannot reconstruct full proposal terms from contract hashes.
- The app does not expose every governance selector: facility timelocked term/book/oracle changes, governor handover, partner upgrades/auto-modules/write-offs and platform reserve withdrawal are outside this transaction inventory.
- Histories remain bounded to 500 advances/requests, 128 open platform requests, and the latest 100 events within 10,000 blocks. Indexed long-term history is not connected.

Owned changes are under `app/src/chain`, chain/facility/partner unit tests, and this file. UI integration and signed browser E2E are separate worker ownership. No commits or pushes were made by this audit worker.
