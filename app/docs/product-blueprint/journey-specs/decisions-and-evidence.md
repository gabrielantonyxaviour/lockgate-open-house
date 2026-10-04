# Decisions and launch evidence

This review defines a complete proposed product without deciding unresolved economics or claiming production readiness. The decision and evidence distinctions follow `rule/name-object-scope-consequence`, `rule/cover-reachable-states` and `rule/success-state-specific`.

## Ten consequential decisions before implementation

These are recommended starting positions for discussion, **not approved policies**. Demo fixtures may choose explicit example parameters without making those production decisions.

| ID | Decision / proposed default | Why it changes a journey | Owner / evidence needed |
|---|---|---|---|
| D-STRUCTURE | Name one vehicle/issuer, its manager, custodian, registrar and eligible provider audience; start with firm-approved audience under reviewed scope | Determines who issues provider shares, signs, accepts subscriptions, owns purchased claims and lends | Firm governing body and counsel; actual vehicle documents, licence scope and audience assessment |
| D-ROUTES | Approve instrument/route combinations individually; neither A nor B is the universal default | Determines investor rights, borrower identity, transfer/release documents and settlement proof | Originator, purchasing/lending vehicle and counsel; actual underlying instruments and consents |
| D-ONBOARDING | Firm-led eligibility/subscription acceptance; separate organizational reviewers and signer authorities; dedicated verified signing workflow | Determines approval, countersignature, expiry, wallet recovery and who can fund | Firm/vehicle and operations; KYC/KYB process, signing method, delegated authority, retention/privacy policy |
| D-SETTLEMENT | Atomic DvP only where both legs truly share enforceable execution; otherwise authenticated registrar lock and agreed conditional payment | Determines when rights change, when “paid” is safe, who handles a failed leg and how long cash remains reserved | Registrar, originator, vehicle, settlement operator and counsel; settlement/custody/remedy agreement |
| D-RISK | Whitelist instrument and route; define related-group look-through and every percentage denominator; reserve capacity for firm bids | Determines quote availability, concurrent commitments and breach behavior | Firm risk authority; documented NAV/exposure definitions, credit-data freshness, reserve and cash limits |
| D-PRICING | Price A purchase separately from B new debt; disclose investor discount, borrower charge, manager fee and technology fee separately | Prevents forgiveness being presented as partner return and prevents undisclosed fee allocation | Vehicle/originator commercial approvers; cashflow schedule, tax/currency/fee allocation and net provider economics |
| D-VALUATION | Dated administrator-approved NAV; suspend subscription/withdrawal pricing when marks are unreliable; recognize impairment before new cohort entry | Determines fair individual shares, fee accrual, unrealized income and losses | Authorized valuation authority; methodology, correction policy, batch frequency and independent controls |
| D-WITHDRAWALS | Uncommitted cash first under the same disclosed queue policy; unfilled shares retain gains/losses; cancellable unfilled remainder; decide FIFO or pro-rata | Determines timing, priorities, partial fills, share burn, fixed claims and segregated claim cash | Vehicle/provider documents and administrator; queue policy, cutoffs, lockups, payment restrictions and reserves |
| D-RECOVERY | Preserve collection rights after write-off; expressly choose current-holder versus historical-cohort recovery benefit; select debt/reserve waterfall | Determines losses, later recoveries, fairness and closure; current contract families use different priorities | Creditor/vehicle, administrator and counsel; principal/fee/cost priority and enforceable recovery rights |
| D-OPERATIONS | Pause new risk while preserving authorized servicing; name key rotation, upgrade, incidents, complaints, disputes, insolvency and wind-down owners | Determines safe behavior when a firm fails, keys change, a provider is restricted or a source disappears | Operating parties; runbooks, service coverage, funding, monitoring, contingency and authority matrix |

## Demand and partnership evidence ledger

Existing conversations are useful demand evidence. Their evidentiary scope must survive product and pitch writing. Do not label the product “no validation” merely because customers have not signed; do not turn qualitative validation into contracted demand or measured volume.

| Evidence | Attribution / exact existing note | What it supports | What remains unproved |
|---|---|---|---|
| Founder says conversations validate demand | Founder-reported in current planning discussion; no separate transcript supplied for this statement | Founder-reported demand validation; retain this status until linked evidence is added | Exact participant set, unanimity, exit volume, conversion and willingness to pay |
| Kasu reply about in-house early-exit capability and securities-licensing constraint | [Outreach log, 28 September reply](../../../../../outreach/LOG.md#replies), line 62; [decision note, 29 September](../../../../../ideation/DECISIONS.md#tue-29-sep-2026-repositioning-after-the-licensing-signal), lines 115–133 | A named prospective originator recognized the problem and discussed possible pathways | Customer contract, approved structure, legal clearance, commercial integration or commitment to use Lockgate |
| Kasu follow-up discusses constraints and possible financing/curator approach | [Outreach log](../../../../../outreach/LOG.md), line 75 | Further prospective-partner engagement and unresolved structure constraints | That either proposed Lockgate route is permitted, commercially accepted or uniquely needed |
| Existing holder reports frozen withdrawals and reluctance to sell at a steep discount | [Outreach log](../../../../../outreach/LOG.md), line 76 | Specific qualitative exit pain and price sensitivity | Broad demand prevalence or willingness to accept Lockgate's eventual price |
| Sizing/operating questions sent | [Outreach log](../../../../../outreach/LOG.md), line 46 | Discovery attempted on queue volume, discount appetite, reserves and external-provider value | An answer, signed cap, first-loss commitment or measured addressable queue |

The notes above were read locally; no outreach was sent. Public materials should anonymize private individuals or quote only with appropriate authorization. A prospect can appear in this internal evidence ledger while remaining absent from the supported-fund catalogue. No live commercial originating funds or signed customer commitments are established by this specification.

## Mainnet release gates

“Not live only because audits are pending” would be inaccurate. Each gate below must have evidence for the actual target, parties and final source before a production launch claim.

| Gate | Minimum evidence |
|---|---|
| Legal and regulatory | Actual issuer/vehicle/manager roles; activity/jurisdiction and audience assessment; instrument/route permission; approved document package, signature/acceptance process and data obligations |
| Commercial partner and asset integration | Named authorized originating platform and borrower; contracted data/servicing/settlement duties; authenticated holdings and consent/lock/transfer/discharge integration; approved operational acceptance |
| Audits and security | Reviewed final contracts and services, authority/tenant tests, audit scope and resolved findings, key custody/upgrades and incident controls; no claim that one contract audit covers legal or offchain operations |
| Operational services | Actual KYC/KYB/review, signing, registrar, administrator/valuation, settlement, dispute/recovery and wind-down workflows with owners and service continuity |
| Funding and monitoring | Committed usable vehicle liquidity, appropriate reserve, supported asset and gas, reconciled ledgers, capacity management, due-date/source/incident monitoring and funded operation |
| Final release verification | Approved target; correct deployed bytecode/configuration; actual end-to-end journeys and adverse paths against final source; fresh evidence for every public claim |

## Source and research boundaries

The coordinating review checked the [MAS tokenisation guide](https://www.mas.gov.sg/-/media/mas/sectors/guidance/guide-on-the-tokenisation-of-capital-markets-products.pdf) and [Kasu important information](https://kasu.finance/docs/user/important-information-when-lending/important-information). Their role here is to keep activity-specific review and underlying legal rights explicit. They do not authorize this product. Kasu remains a prospect; its documents cannot be treated as consent to an assignment, new loan or integration.

UX references are recorded in [experience.js](../experience.js): selected ReUI onboarding composition, Docusign signing status/records, wallet account/network lifecycle and Maple queue state distinctions. The coordinating review refreshed the [exact ReUI onboarding-8 page](https://reui.io/blocks/application/onboarding/onboarding-8), official Maple queue interface and Docusign signing-status article. This writing pass read the local specification and source; no ReUI block code was purchased, downloaded or installed. References inform interactions, not Lockgate legal validity or implemented capabilities.
