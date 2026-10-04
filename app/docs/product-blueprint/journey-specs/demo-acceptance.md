# Demo scope and acceptance

Proposed executable test scope after product decisions and implementation authorization. This specification and the visual preview are review artifacts, not passing tests. A completed demo requires genuine test-document signing, authorized financial transactions and reconciled records on its explicitly stated environment.

Current sequencing: [wallet-first entry and investment-firm-first setup](entry-and-build-order.md).
Provision five fictional TEST firms and five independently funded, active USDG vaults
before exit demos. These are separate from the five originating-platform fixtures below.

## Fixtures and actors

Use **five fictional/test originating platforms**, never real prospect branding as an integrated partner. Proposed fixture coverage:

| Fixture | Proposed purpose |
|---|---|
| TEST Originator 01 · Alder Test Credit | Divisible tokenized fund shares; onchain register; A and B independently approved for fixture; partial/full exit and competing offers |
| TEST Originator 02 · Birch Test Receivables | Assignable investor loan claim; offchain registrar; A only; whole-claim assignment until separate partial-assignment approval |
| TEST Originator 03 · Cedar Test Income | Private fund interest; offchain administrator; B only; agreed old-claim discharge plus separate named borrower debt |
| TEST Originator 04 · Dune Test Notes | Divisible tokenized note; onchain note register; A only; acquired-right servicing and related-originator risk grouping |
| TEST Originator 05 · Elm Test Private Credit | Registered units; offchain transfer agent; conditional A/B integration, not activated in the unready scenario; stale records, reserve shortfall and recovery checks |

Names and records above are invented fixtures, not real funds. Display TEST provenance beside the identity/asset source. At least one fixture must be inactive or not exit-ready to prove readiness filtering rather than marking every registration available. Fixtures may be reset only through an explicit authorized test procedure; preserve proof IDs for completed runs.

Four personas require **five distinct actor wallets** to also test two providers: exit investor, originator issuer/borrower representative, manager/vehicle approver, provider A and provider B. Use separate internal operator/registrar credentials where that authority is required. Do not reuse the manager wallet as a provider or quietly count two provider profiles on one wallet as ownership-isolation proof. Originator fixtures may share a declared test operator, but their entities, records, reserves and exposures remain separate.

Provider A/B amounts must be unequal; cross a valuation change, partial withdrawal and loss/recovery event. TEST identity selection binds to actual wallet, role and environment; it does not fake legal signature, acceptance or chain permission. Production paths cannot enable fixtures via query string or local storage.

## Testable acceptance IDs

| ID | Execute | Pass condition / evidence |
|---|---|---|
| J-U1 | Browse disconnected; deliberately connect before choosing each of four tasks | Compact wallet-first entry; 01/04 Get Started enter in-app onboarding, 02/03 Talk to us enter team-led contact/invitation; equal card/action geometry; no role choice or invitation creates approval; optional public terms; no unsolicited wallet prompt or commercial supported-fund claim |
| J-U3 | Return with completed, incomplete and new authenticated wallet profiles; change accounts; fail profile lookup | Dashboard, saved step and four-choice routing respectively; no repeated completed onboarding; lookup failure offers Retry rather than new-profile fallback; private profile and permissions remain scoped |
| J-U2 | Traverse all role screens at 375/768/1440 widths and by keyboard | Compact headings; visible primary action/focus; labels/status readable; long identifiers and partial/error data fit; save/Back never accidentally submit |
| J-I1 | Bind TEST fixture, then change account, chain, role and expiry | Dependent unsigned reviews invalidate; unauthorized new action blocked; fixture cannot grant contract permission; submitted receipts/history survive in correct identity scope |
| J-K1 | Select all ten preverified TEST identities for 01/04; use verified wrong owner; attempt protected deep links | 01 match uses trusted subject/account/wallet/holding references; wrong owner cannot see private records, receive offers or sign; empty differs from failed read; 04 needs no old holding and still requires vehicle eligibility; fixtures cannot grant real authority |
| J-Q1 | Submit 02/03 enquiry; retry, reject invalid input and fail acknowledgement delivery | Durable enquiry before receipt; role-specific content, escaped branded HTML and text alternative, verified sender; idempotent retries; receipt not approval; delivery failure preserves enquiry and enables safe retry; no false inbox-delivery claim |
| J-F1 | Three firms co-fund one large accepted exit; one reservation expires; two settlements contend | Approved separate-vehicle slices sum to accepted payout; exact limits/consents enforced; no cross-vault cash access or silent partial payout; unknown receipt retains commitments; route-specific rights and collections reconcile |
| J-I2 | Replay challenge, alter document/amount/recipient, skip counterpart acceptance and visit forged signing-return URL | No false signing/acceptance/funding state; exact document version and actual signatures required; rejected/pending/expired cases recover without lost draft |
| J-X1 | Unfunded test investor deliberately obtains compatible assets and test holding | Supported funding mechanism and actual deposit/holding creation receipts; refreshed owned quantity; funding/approval/test subscription states distinguishable |
| J-X3 | Select exit role; complete KYC first; automatically discover identity-matched positions; use Demo sheet to mint a supported test debenture/nontransferable holding | Matched/empty/error/account-link states differ; actual authorized mint and refreshed holding precede exit; no fake balance, production-chain mint or elevated judge permission; unknown receipt cannot mint twice |
| J-X2 | Request partial exit from fresh matched holding | Quote quantity, residual rights, fee/net payout, route, expiry and reservation align; unsupported/mismatched/stale holding cannot be offered as owned |
| J-H1 | Two concurrent exits plus ordinary redemption compete for same slice | Only one lock/settlement succeeds; remainder stays usable; duplicate registrar message/retry is idempotent; no timeout unlock while payment status unknown |
| J-A1 | Buy transferable test units and assignable test loan claim via A | Correct buyer vehicle owns exact transferred slice; investor receives agreed payment; no fabricated new borrower debt; subsequent collections reconcile to acquired asset |
| J-B1 | Finance discounted full settlement via B | Investor payout and old-claim discharge reconcile; old slice cannot redeem again; separately executed named borrower debt records its own principal/charge/due amount; investor discount is not auto-booked as partner income |
| J-S1 | Fail each leg of onchain and registrar conditional settlement | Atomic path reverts together where promised; offchain partial outcomes enter visible exception state with durable references and agreed remediation; never label offchain atomic |
| J-S2 | Lose RPC/payment response after submission, reload and change wallet | Original hash/instruction persists; recheck resolves confirmed/reverted/unknown; no duplicate funding, share allocation or payout |
| J-O1 | Originate application through organization review, legal/credit review, signatures, records tests and conditional activation | Local export never equals sent application; registered/funded/operational/ready separate; wrong signer, stale records, missing reserve/capacity block readiness |
| J-M1 | Try unapproved instrument/route, invalid licence/vehicle scope and signer-only withdrawal | All denied at authoritative boundary; no wallet-selected licence; permitted role can perform only its scoped task; audit names actual vehicle |
| J-M2 | Evaluate percentage limits after related-group exposure, reservation and NAV impairment | Approved denominator and source time used; related exposure aggregates; new risk stops on breach; existing repayment/servicing remains possible |
| J-M3 | Onboard and fund five distinct TEST firm-managed USDG vaults through the agreed firm flow | Each has approved TEST profile, separate vehicle/address, correct owner/signers, real funded balance, active mandate, approved origin/instrument/route and risk headroom; profile creation alone cannot make a firm exit-ready |
| J-C1 | Two bids and provider withdrawal contend for the same idle cash | Capacity reserves exactly once; commitments and fixed claim cash cannot be lent again; safe expiry releases only unused capacity; current non-reserving quote is insufficient |
| J-P1 | A/B providers complete TEST eligibility, real test agreements, distinct acceptance and unequal funding | Every pre-funding prerequisite enforced; actual transfers and individually attributable units reconcile; manager and other provider cannot spend those interests |
| J-P2 | Change NAV, assess fees/loss, add subscription and test rounding/donation | Per-provider share price/equity reconciles; originator reserves and pending subscriptions excluded; no hidden historical-loss transfer; donation/rounding policy exercised |
| J-P3 | Withdraw eligible idle amount, queue excess, partially settle, cancel unfilled remainder and pay fixed claim | Exact shares/claims/cash reconcile at every step; no double burn/payment; stale valuation/restriction preserves rights and gives recovery; no guaranteed date |
| J-P4 | Revoke eligibility, change manager key, lose provider wallet and begin wind-down | New activity restricted under fixture policy; existing ownership/history/claims preserved; governed recovery requires authority; closure does not erase unresolved rights |
| J-R1 | Borrower late payment, reserve shortfall, impairment/write-off and later recovery | Principal, fees, collateral recovery, loss and legal rights remain distinct; recovery goes to chosen beneficiary; write-off does not silently discharge debt |
| J-E1 | Reconcile full run and inspect evidence labels | Source SHA, deployment/network, actors, fixture policy, signed-document references, actual receipts and ledger totals recorded; local/fork/Sepolia/preview/production claims separate |

## Completion boundary

`J-*` items remain **not executed by this documentation pass**. Existing historical signed owner-funded flows do not pass provider, offchain registry or agreement checks. A preview interaction can illustrate these states but cannot satisfy a financial acceptance ID.

Record source/deployment identity, actor role, test input, expected/actual result and authoritative evidence reference for every executed case. Follow the user instruction on proof artifacts: inspect rendered behavior, but create screenshots/video/proof documents only when requested. A run may store necessary transactional/audit records as part of the product; do not fabricate signed documents or mark simulated receipt rows as chain evidence.

A publicly reachable Sepolia demo is still a test product. Production requires every [launch gate](decisions-and-evidence.md#mainnet-release-gates), approved target and separately verified deployment. Audits alone cannot authorize launch.
