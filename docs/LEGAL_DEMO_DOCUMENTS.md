# Lockgate TEST execution documents

These are structured demonstration letters, not counsel-approved production contracts. They implement the current demo mechanics and do not establish any real entity's licensing, a legally effective assignment, a production offering, or enforceability. Singapore is a drafting reference only; no real governing law or dispute forum is selected.

## Canonical builders

`harness/src/demo/legal-documents.ts` exports two pure string builders:

```ts
exitAgreementText(input: ExitAgreementInput): string
subscriptionAgreementText(input: SubscriptionAgreementInput): string
```

Both take an immutable document ID, version, preparation time, acceptance expiry, nonce, TEST profile, asset and vehicle. Profiles include the full required signer name, jurisdiction, identity reference/commitment and wallet. A postal address may be supplied only when actually collected; absent addresses are explicitly uncollected. Firm and originator names come from the fictional deployment fixture, with their actual demo wallet and contract addresses. Never invent company registration numbers, licences, physical addresses or authorized humans for those entities.

Exit input adds the holding ID/name/instrument, originator, settlement contract, route `1 | 2`, raw `bigint` units/payout/repayment/residual units, and maturity. Claim units use the contract's six decimals. The fixture's one claim unit to one asset unit face convention is disclosed. Exact amounts and integer discount fraction are retained without floating-point conversion.

Subscription input adds the raw `bigint` amount and `fundingExpiresAt`. Preparation must freeze both deadlines: the review/signature expiry and the later on-chain funding deadline. Firm acceptance must use that exact funding deadline; it must not invent a fresh period after signing. The deployed vehicle's `termsText` is reproduced verbatim in Appendix A. Its existing immutable `termsHash` must remain unchanged.

## Rights and mechanics

| Route | Investor result | Vehicle result | Repayment responsibility |
| --- | --- | --- | --- |
| Purchase / assignment | Receives payout and transfers exited claim portion | Acquires collection rights | Originator meets the collection obligation |
| Financing / discharge | Receives payout and exited portion is discharged | Receives separate originator financing receivable | Originator owes facility principal and charge |

The investor never becomes the facility borrower or guarantor. A partial exit leaves the residual claim's existing rights unchanged. Reservation is a temporary lock, not settlement. Cancellation or expiry releases through the permitted contract path. Settlement evidence requires confirmed contract events.

Providers subscribe to nontransferable interests in one firm-owned vehicle. Pricing follows the actual contract book NAV and rounding. Unreserved cash plus no open queue permits immediate withdrawal; otherwise a first-in, first-out request may be partially filled. Unfilled queued units remain exposed to NAV changes. Filled amounts require a claim transaction. Impairment affects units exposed at the time; subsequent recoveries use the contract's recorded beneficiary weights. No principal protection, yield or redemption date is guaranteed.

## Signature and evidence contract

1. Show the complete canonical letter in a readable document view. A short overview may precede it but must not replace its terms.
2. Require the full verified TEST profile name to be typed, then affirmative checkbox consent, then wallet authorization. Backend enforcement must compare the accepted name with the bound profile and reject missing or mismatched acceptance.
3. For exits, compute `keccak256(toHex(letter))`, bind it as `agreementHash` inside the EIP-712 quote, and preserve the exact originator/investor signatures and signing domain. Generate the document reference and nonce before constructing the letter.
4. For subscriptions, sign the full immutable letter with `personal_sign`. Preserve its separate document digest; this is not the vault's existing policy hash. Verify recovered signer, exact amount, current identity and both deadlines before firm acceptance.
5. Preserve the original text, hashes, version, nonce, typed name, affirmative consent, actual acceptance time, signature, verified wallet, and transaction receipts. Do not insert the letter's own digest or later signature timestamps into its canonical text after hashing. Attach execution evidence separately.
6. A changed wallet, identity, amount, asset, route, deadline or document creates a new review and signature. Old records remain evidence and must not be silently rewritten.

Signing proves use of a wallet key. The TEST identity fixture is not production KYC or proof of civil identity. A signature or firm acceptance does not establish settlement or token delivery. A token allowance does not replace agreement acceptance.

## Primary legal sources checked on 4 October 2026

- [Electronic Transactions Act 2010, section 8](https://sso.agc.gov.sg/Act/ETA2010?ProvIds=pr8-): an electronic signature method must identify the person and express intention, with reliability appropriate to the circumstances or demonstrated performance. Typed name, affirmative intent and exact-document wallet authorization are evidence design choices; the Act does not automatically certify this implementation.
- [Electronic Transactions Act 2010, section 11](https://sso.agc.gov.sg/Act/ETA2010?ProvIds=pr11-): electronic offer and acceptance are permitted; electronic form alone is not grounds to deny validity or enforceability. This does not settle capacity, authority, licensing or instrument formalities.
- [Electronic Transactions Act 2010, First Schedule](https://sso.agc.gov.sg/Act/ETA2010?ProvIds=Sc1-): listed exclusions include wills, specified indentures/trusts/powers of attorney, and immovable-property matters. Exceptions and commencement status require current review. These letters do not purport to create a trust, deed, power of attorney or land transfer. Their use with an underlying instrument still requires instrument-specific advice.
- [IMDA, Electronic Transactions Act and regulations](https://www.imda.gov.sg/regulations-and-licensing-listing/electronic-transactions-act-and-regulations): IMDA describes electronic execution across ordinary commercial functions and the separate framework for electronic transferable records. A tokenized claim should not be assumed to meet all transferable-record requirements merely because it uses blockchain.
- [MAS, Capital Markets Services licence](https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/cms-licence): regulated activities include dealing, fund management, product financing and securities custody. Applicable permissions and exemptions depend on actual activities and facts; software, non-custody labels, wallet execution and fictional firm roles do not settle them.
- [MAS Financial Institutions Directory](https://eservices.mas.gov.sg/fid/institution?sector=Capital+Markets): use actual entity/activity records to verify production counterparties. None of the demo firm labels is asserted to hold a licence.

Direct SSO page opens returned access errors during research; the primary site's indexed statutory section and schedule text was retrievable through targeted searches. No secondary commentary is relied on for the legal propositions above. This research is a drafting constraint, not a legal opinion on production enforceability.

## Asset and rollout boundary

`custom-test-usdg` documents identify custom Lockgate TEST USDG and expressly distinguish it from Paxos USDG. `paxos-test-usdg` documents identify the configured Paxos-issued test USDG contract and test network only. The builder supports both; support does not activate the staged migration. Neither mode promises real-dollar redemption, issuer partnership or reward eligibility. Production migration, deployment and real-asset transactions remain outside this document task.

## Integration acceptance checks

- Both route letters preserve the investor non-borrower condition and residual claim treatment.
- All exact economic fields, nonce, names, addresses, network and both relevant expiry fields come from the frozen authorized record.
- A one-character canonical-text change changes the digest. The full policy appears byte-for-byte in the subscription appendix.
- Changed name, wallet, identity, amount, or expired review/funding record is rejected by runtime acceptance.
- Signing prompts bind the document actually shown. Views may wrap text but must not regenerate the canonical text or compute a hash from HTML.
- No real licence claim, legal entity invention, production asset statement, guaranteed yield or guaranteed redemption appears.

These checks describe the integration contract; the coordinator reports which runtime and browser checks were actually executed.
