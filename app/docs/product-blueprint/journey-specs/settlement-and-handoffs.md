# Settlement and cross-persona handoffs

Proposed transaction contract. Both routes require instrument-specific legal, authority, commercial and technical approval; neither is legally cleared. Loan versus token form does not determine route. [Shared rules R1–R6](README.md#rules-applying-to-every-screen-row) govern every state and decision below.

## Two permitted designs, subject to approval

| Property | A · Purchase existing asset/right | B · Finance full settlement and create new debt |
|---|---|---|
| Investor's legal action | Sell existing fund units or assign an assignable loan claim | Accept specified early payout in full settlement of precisely identified old claim/slice; release becomes effective under agreed payment conditions |
| Partner's acquired right | Purchasing vehicle acquires the existing units/claim and associated rights/risks | Financing vehicle becomes creditor of the expressly named borrower under a separately executed new financing obligation |
| Required counterparty | Actual buyer vehicle; management company only if it is itself the authorized buyer | Actual borrower and old obligor explicitly identified; they can differ from platform operator and each other |
| Investor's old claim | Transferred to buyer for the settled slice | Discharged for the settled slice; not assigned to partner or left redeemable by investor |
| Later cash | Collection/redemption/payment on purchased asset according to its terms | Borrower repayment of new debt, under its own principal, financing charge, maturity and priority |
| Feasibility | Transferability/assignment, consent, investor/buyer eligibility and registration must be proven | Borrowing/settlement authority, effective release, enforceable new debt, priority and repayment source must be proven |
| What must not be inferred | A recorded token is freely transferable; an assignable loan is necessarily route B | Nontransferable old claim makes B lawful; old-claim forgiveness automatically creates partner income |

**Illustrative arithmetic, not commercial terms:** an old claim has reference face 100,000 and the investor agrees to receive 98,000. Under A, the buyer pays 98,000 for the existing asset; eventual collections determine gain/loss after costs. Under B, 2,000 is investor discount/forgiveness on the old claim. If the separately agreed new facility principal is 98,000 with finance charge 1,500, the borrower owes 99,500. The partner does not automatically own a 100,000 receivable or earn 2,000. An alternative debt amount needs explicit agreement and valid accounting. All amounts, currencies, taxes and fees must be separately disclosed.

## Asset and payment control

The unit of exclusivity is `(originator, instrument, authoritative holding/claim ID, owner, slice/quantity, version)`. A lock covers competing early exits, sale/assignment, collateral use and ordinary redemption of the same slice to the extent the integration can enforce them. A partial lock leaves a separately reconciled available remainder. Partial exit is available only where the instrument, assignment terms and registrar mechanics support dividing that entitlement; a partial loan-claim assignment cannot assume the legal treatment of a complete assignment. If an external action cannot be blocked or reliably detected, this instrument cannot be advertised as ready for that settlement route.

An exited investor does not become the ordinary borrower responsible for route B financing repayment merely by taking an exit. Applicable sale warranties, indemnities, clawbacks or exceptional recourse remain counsel-defined and must be disclosed in that investor's review; neither route promises zero liability in every circumstance.

| Mode | Required sequence | Success evidence | Failure / recovery |
|---|---|---|---|
| Onchain A | Verify eligibility/consents → reserve vehicle cash → lock permitted asset slice → review → execute atomic payment and permitted asset transfer | Successful receipt plus buyer ownership and investor payment reconcile | Atomic revert changes neither leg; submitted-but-unknown retains reference and locks until chain reconciliation |
| Onchain B | Verify agreements/authority → reserve cash → lock old claim slice → execute atomic payout, old-claim discharge and recording of authorized new borrower debt where integration supports it | Receipt/event plus investor payment, discharged old claim and borrower debt match agreed terms | No ready claim if discharge/debt is only an unchecked external promise; non-atomic parts require the conditional process below |
| Offchain A | Authenticate holding/consents → registrar lock → fund agreed conditional settlement mechanism → registrar validates/records transfer under conditions → release payment under agreed coordination → reconcile both legs | Registrar's authenticated transfer record plus verified cash movement and settlement ID | Transfer-without-payment/payment-without-transfer becomes settlement exception; operator follows agreed release/reversal/remedy; never report atomicity |
| Offchain B | Authenticate old claim/borrower terms → registrar/obligor lock → fund conditional mechanism → confirm conditional discharge and debt execution → release payment under agreed conditions → reconcile | Old-claim discharge, actual payout and separate new borrower debt agree | No premature unconditional discharge; unknown payment prevents lock release and conflicting ordinary redemption; contract defines remedial rights |

Conditional mechanism, operator, cash custody, settlement deadline and compensation/remedy are **open decisions**. “Registrar-confirmed” is an evidence requirement, not a claim that a trusted escrow, legal finality or compensation fund already exists. Offchain records remain access-controlled; external reference IDs do not expose customer identity on chain.

## State ownership and handoffs

| State / owner | Entry evidence | Other persona sees / may do | Allowed next state | Failure handling |
|---|---|---|---|---|
| Draft / applicant | Saved local fields | Owner resumes; reviewer sees nothing until sent | Application received | Storage failure shown; no submission invented |
| Reviewing / authorized reviewer | Durable application plus supplied evidence | Applicant sees missing requirement; reviewer approves/rejects | Eligible, conditional, rejected, expired | Reason and re-review route; approval cannot be selected by wallet |
| Holdings matched / registrar | Authenticated record bound to client/wallet | Investor selects available slice; firm reads authorized credit data | Quote eligible | Mismatch/staleness holds progress, preserves application |
| Indicative quote / engine or firm | Terms estimate without reservation | Investor compares; firm may commit | Reserved bid, unavailable | No implied guaranteed capacity |
| Reserved bid / funding vehicle | Cash commitment, scope, expiry, approved route and mandate | Investor signs exact offer; other firm bids see reduced cash | Accepted pending settlement, expired, withdrawn when permitted | Cannot release capacity while payment outcome unknown |
| Documents signed / required signers | Verified signatures for exact versions | Counterpart signs or authorized party accepts | Executed and accepted | Signed-by-one-party is not full execution; acceptance separately evidenced |
| Holding locked / registrar or contract | Exclusive lock on exact slice | Investor sees unavailable slice; originator blocks duplicate payout | Settlement pending, cancelled/released if safe | Stale lock needs owner/operator reconciliation; no timeout release during unknown payment |
| Submitted / paying actor | Transaction hash or payment instruction ID | All authorized parties track same reference | Confirmed, reverted/rejected, outcome unknown | Preserve ID across reload/account change; no new payment until resolved |
| Cash confirmed / payment rail | Actual final receipt according to rail policy | Investor sees payment evidence; registrar/manager reconcile rights | Settled or exception | Cash alone is not title transfer/discharge/subscription allocation |
| Settled A / registrar + vehicle | Payout and title transfer reconciled | Investor residual position; manager acquired asset | Servicing, collections, impairment | Disputed title or correction remains auditable |
| Settled B / obligor + vehicle | Payout, old-claim discharge, new borrower debt reconciled | Investor receipt; originator/borrower debt; firm receivable | Repayment, late, recovery | Old debt cannot silently revive or remain payable after discharge |
| Provider subscription accepted / issuer | Eligible client + executed docs + authorized amount/deadline | Provider can fund accepted subscription | Payment pending, allocated, expired, rejected | Unmatched cash held under defined reconciliation/refund policy |
| Provider allocated / share authority | Payment and individual unit issuance reconciled | Provider sees personal interest; manager serves ledger | Withdrawal requested, distribution, impairment | Manager owner changes never overwrite holder ledger |
| Withdrawal queued / provider + queue | Shares reserved once; policy/version/cutoff | Provider tracks/cancels permitted remainder; manager processes | Partial/full settlement, cancelled remainder | Unfilled shares retain economic treatment specified in terms |
| Fixed withdrawal claim / administrator | Settled shares burned; cash allocated once | Provider claims/receives; firm cannot lend reserved cash | Paid, transfer exception | Failed transfer preserves fixed claim |
| Late / creditor | Due amount unpaid under agreed rule | Originator services debt; firm assesses impairment; providers see NAV effect | Recovery, impairment, repayment | Lateness is not automatically full loss |
| Written off / accounting authority | Authorized impairment/write-off record | Parties see economic loss and retained collection rights | Later recovery, legal release if separately authorized | Do not equate accounting write-off, legal forgiveness and abandoned collection |

## Invalidation and durable history

Account, chain, identity scope/expiry, agreement version, asset owner/quantity, record version, price/NAV, reserve, mandate, route or recipient changes invalidate dependent unsigned reviews and funding authorization. Preserve existing signed versions and submitted references. A changed legal term needs new required signatures/acceptance; a mere refresh does not erase proof. Server/contract authority—not browser storage—enforces each transition.

Every handoff carries durable ID, object version, actor authority, event time, environment, source reference and correlation to the previous step. Idempotency keys prevent duplicate acceptance, locking, funding, allocation and payout. Privileged transitions require tenant isolation and an audit trail; a support role cannot move money just because it can view a case.

## Distinct cash buckets

Vehicle cash, reserved bids, investor settlement payments, purchased assets, borrower receivables, originator collateral, pending provider subscriptions, share equity, fixed withdrawal liabilities, fees and recovery proceeds each have separate ledger treatment. Count each once. Reserve collateral is not provider equity; withdrawing manager-owned idle cash is not a provider withdrawal; reserve recovery is not timely borrower repayment.

Route classification and legal-role policy are domain decisions, not generalized UX rules: **coverage gap (proposed) `rule/financial-rights-evidence`**, new category Financial rights — every displayed transfer/discharge/debt/ownership claim requires its own authoritative evidence. This is a proposal for this specification, not an existing skill rule.
