import { formatUnits, type Address, type Hex } from 'viem';

export type LegalProfile = {
  id:string; name:string; jurisdiction:string; identityRef:string; identityHash:Hex;
  wallet:Address; postalAddress?:string;
};
export type LegalAsset = {
  name:string; symbol:string; address:Address; chainId:number; chainName:string;
  decimals:number; kind:'custom-test-usdg'|'paxos-test-usdg';
};
export type LegalVehicle = {
  id:string; name:string; firm:string; address:Address; manager:Address; termsHash:Hex; termsText:string;
};
export type LegalDocumentInput = {
  documentId:string; version:string; createdAt:string; expiresAt:string; nonce:string;
  profile:LegalProfile; asset:LegalAsset; vehicle:LegalVehicle;
};
export type ExitAgreementInput = LegalDocumentInput & {
  holdingId:Hex; holdingName:string; instrument:string; originator:{name:string;address:Address};
  settlement:Address; route:1|2; units:bigint; payout:bigint; repayment:bigint;
  residualUnits:bigint; maturity:string;
};
export type SubscriptionAgreementInput = LegalDocumentInput & { amount:bigint; fundingExpiresAt:string };

const section = (heading:string, ...paragraphs:string[]) => [heading, ...paragraphs].join('\n\n');
const money = (value:bigint, asset:LegalAsset) => `${formatUnits(value,asset.decimals)} ${asset.name} (${value} base units)`;
const units = (value:bigint) => `${formatUnits(value,6)} testnet claim units (${value} base units; 6 decimals)`;
const header = (a:LegalDocumentInput,title:string) => [
  'LOCKGATE — testnet EXECUTION DOCUMENT', title,
  'Fictional parties and test assets only • Singapore working draft • Not a production offering',
  `Document reference: ${a.documentId}`, `Version: ${a.version}`, `Prepared at: ${a.createdAt}`,
  `Acceptance expires at: ${a.expiresAt}`, `Unique nonce: ${a.nonce}`,
].join('\n');
const parties = (a:LegalDocumentInput,role:string) => [
  `${role} / required full-name signer: ${a.profile.name}`,
  `testnet profile: ${a.profile.id}; identity reference: ${a.profile.identityRef}`,
  `Identity commitment: ${a.profile.identityHash}`, `Profile jurisdiction: ${a.profile.jurisdiction}`,
  `Postal address: ${a.profile.postalAddress ?? 'Not collected in this testnet fixture; no real address is asserted.'}`,
  `${role} wallet: ${a.profile.wallet}`, `Fictional investment firm: ${a.vehicle.firm}`,
  `Firm manager wallet: ${a.vehicle.manager}`, `Firm-owned vehicle: ${a.vehicle.name} (${a.vehicle.id})`,
  `Vehicle contract: ${a.vehicle.address}`,
].join('\n');
const assetTerms = (a:LegalDocumentInput) => [
  `Settlement asset: ${a.asset.name}; symbol: ${a.asset.symbol}`,
  `Token contract: ${a.asset.address}`, `Network: ${a.asset.chainName}; chain ID: ${a.asset.chainId}; token decimals: ${a.asset.decimals}`,
  a.asset.kind==='paxos-test-usdg'
    ? 'This document identifies Paxos-issued test USDG on the stated test network only. It does not represent production USDG, a dollar redemption entitlement, a Paxos partnership, or reward eligibility.'
    : 'This document identifies the custom Lockgate testnet USDG contract only. It is not Paxos-issued USDG. A staged migration or another asset shown elsewhere does not replace this contract or authorize a token substitution.',
].join('\n');
const identityTerms = 'The named profile, identity commitment and signing wallet must match the current testnet registry and the relevant holding or subscription. A mismatch, revoked binding, unavailable authority or changed account prevents execution. Profile verification in this environment is a seeded fixture: it does not establish a real person’s identity, accreditation, beneficial ownership, sanctions clearance or investment eligibility. The participant confirms control of the signing wallet and authority to act as the named testnet persona. No person should enter a third party’s real identity or sign for an undisclosed principal.';
const statusTerms = 'The parties use this letter to record the economic terms and consent for a testnet transaction. The investment firm and originator names are fictional fixture labels; their wallet and contract addresses identify the actual demo actors. Any licensed-firm role is a simulation, not a statement that an entity holds a licence, exemption or regulatory approval. Lockgate supplies the workflow and evidence interface; this letter neither appoints it as an investment adviser nor establishes that its activities fall outside regulation. The document does not offer real securities, create a production fund, or promise legal enforceability.';
const lawTerms = 'Singapore is the working drafting reference for this testnet exercise only. This letter does not choose governing law, courts or arbitration for real counterparties. Before any production transaction, appropriately qualified counsel must settle the actual parties, capacity, jurisdictions, regulatory permissions, instrument-specific transfer and notice formalities, insolvency treatment, execution method and dispute terms. No trust, power of attorney, deed or security interest is constituted by this test letter. Electronic consent cannot cure a missing licence, prohibited transfer or other substantive legal defect.';
const consentTerms = (a:LegalDocumentInput) => `The participant must first type their complete verified testnet profile name, “${a.profile.name}”, then affirm the acceptance checkbox, and then authorize the wallet signature over the exact presented document or its bound digest. Typing a name alone, ticking a box alone, connecting a wallet, or approving token spending alone does not complete this acceptance process. By completing those steps, the participant expresses an intention to approve these testnet terms, confirms that the displayed full name and wallet identify the same testnet persona, and consents to electronic delivery and retention of the document and execution evidence. The wallet signature proves authorization by the signing key; it does not independently prove civil identity or a statutory secure-signature classification.`;
const signer = (a:LegalDocumentInput,method:string) => section('SIGNER AND EXECUTION RECORD',
  `Required typed full name: ${a.profile.name}\nCapacity: Named testnet persona, acting for self\nSigning wallet: ${a.profile.wallet}\nSignature method: ${method}`,
  'The separate execution record supplies the accepted typed name, affirmative consent, signature, signature verification result and actual acceptance timestamp. These fields are not pre-signed by the printed name above. Transaction hashes and confirmation status are added as linked evidence when available. A prepared document is not a completed transaction.');

/** Canonical immutable UTF-8 text; hash this exact return value, without HTML or reflow. */
export function exitAgreementText(a:ExitAgreementInput):string {
  if (a.asset.decimals!==6 || ![1,2].includes(a.route) || a.units<=0n || a.payout<=0n || a.payout>a.units || a.residualUnits<0n || a.repayment<a.payout)
    throw new Error('Invalid testnet exit economics');
  const purchase=a.route===1;
  const discount=a.units-a.payout;
  return [
    header(a,purchase?'EARLY EXIT PURCHASE AND ASSIGNMENT LETTER':'EARLY EXIT FINANCING AND CLAIM DISCHARGE LETTER'),
    parties(a,'Investor'),
    `Originator: ${a.originator.name}\nOriginator authorized wallet: ${a.originator.address}\nSettlement contract: ${a.settlement}`,
    section('1. PURPOSE AND PARTIES',statusTerms,
      `Dear ${a.profile.name}, the firm proposes the transaction scheduled below through its identified vehicle. The originator acknowledges the applicable treatment of its claim. The investor accepts only the selected route; no alternative route may be substituted without a fresh document and signatures.`),
    section('2. TRANSACTION SCHEDULE',
      `Holding: ${a.holdingName}\nInstrument: ${a.instrument}\nHolding identifier: ${a.holdingId}\nSelected route: ${purchase?'Purchase and assignment of claim rights':'Originator financing with investor claim discharge'}\nExited claim: ${units(a.units)}\ntestnet claim face amount: ${money(a.units,a.asset)}\nImmediate investor payout: ${money(a.payout,a.asset)}\nDiscount from exited face amount: ${money(discount,a.asset)}\nDiscount fraction (exact): ${discount}/${a.units} of exited face amount\n${purchase?'Firm collection amount':'Originator facility repayment'}: ${money(a.repayment,a.asset)}\n${purchase?'Purchase cost':'Facility principal advanced'}: ${money(a.payout,a.asset)}\n${purchase?'Collection spread over purchase cost':'Originator financing charge'}: ${money(a.repayment-a.payout,a.asset)}\nCollection / repayment maturity: ${a.maturity}\nInvestor residual claim: ${units(a.residualUnits)}\nResidual testnet face amount: ${money(a.residualUnits,a.asset)}`,
      'The fixture denominates each displayed claim unit at one settlement-asset unit of face amount. This is a testnet accounting convention, not a valuation opinion. The discount is the difference between exited face amount and immediate payout, not an additional debit from the investor. Transaction gas is separate and is shown by the wallet.'),
    section('3. ASSET AND PAYMENT INSTRUCTIONS',assetTerms(a),
      'The scheduled payout is payable solely to the identified investor wallet from the identified vehicle. No different token, chain, receiving address or amount is authorized by this letter. testnet tokens have no promised monetary value or exchangeability for dollars.'),
    section('4. CLAIM RIGHTS AND REPAYMENT OBLIGATIONS',purchase
      ? `Conditional upon successful settlement, the investor sells and assigns the scheduled exited portion of the claim to the firm’s vehicle in consideration of the scheduled payout. The originator acknowledges that the vehicle is the collection beneficiary for that portion. The vehicle’s scheduled collection amount is ${money(a.repayment,a.asset)}, due at the scheduled maturity. This is a purchase of claim rights, not a loan to the investor. The investor no longer collects the transferred portion or its later proceeds.`
      : `Conditional upon successful settlement, the firm’s vehicle advances ${money(a.payout,a.asset)} for the originator’s financing and pays that amount directly to the investor as the agreed early discharge consideration. The exited portion of the investor’s claim is discharged, not retained as a purchased investor claim. The originator separately owes the vehicle ${money(a.repayment,a.asset)}, consisting of the scheduled principal and financing charge, at the scheduled maturity. The originator is the borrower and repayment obligor.`,
      'The investor never owes the facility principal, financing charge or originator repayment and provides no guarantee of originator performance. The firm bears the recovery exposure through its vehicle under the selected route. Originator nonpayment does not recreate the discharged investor claim, reverse a completed sale or make the investor a borrower. No double collection of the exited portion is authorized.'),
    section('5. RESIDUAL CLAIM AND LIMITED SCOPE',
      `After settlement the investor retains ${units(a.residualUnits)} under the original instrument. Only the exited portion is transferred or discharged. The residual portion’s existing obligor, priority, payment terms and rights remain unchanged by this letter. A zero residual denotes a full exit. The scheduled residual is calculated at preparation; settlement must still pass the registry’s current availability checks.`,
      'The investor represents within the testnet fixture that the exited portion is theirs to dispose of and has not been separately transferred or pledged. The originator authorizes only a route supported by the registered instrument. Production assignment restrictions, required consents, notices and perfection steps would require separate verification; a registry update does not establish completion of such legal formalities.'),
    section('6. IDENTITY AND AUTHORITY',identityTerms),
    section('7. CONDITIONS, EXPIRY AND CANCELLATION',
      'Acceptance requires the exact originator-authorized quote, matching investor signature, approved vehicle, permitted mandate, available claim units and sufficient reserved vehicle cash. Reservation temporarily locks claim units and cash but does not pay the investor or complete the transfer or discharge. Settlement must complete before the scheduled acceptance expiry and pass the contract’s current checks. If a condition fails, the transaction must not be presented as completed.',
      'An active reservation may be cancelled through the permitted contract path before settlement; cancellation releases its lock and reserve. Expiry prevents settlement but may require a release transaction. A completed on-chain settlement has no unilateral undo function. Later correction requires a separately authorized remedy and must preserve the original record.'),
    section('8. DEFAULT, RECOVERY AND RISKS',
      'The originator must satisfy the scheduled collection or financing obligation to the vehicle. The demo can record partial repayment, remaining due, overdue impairment and subsequent recovery. An accounting impairment does not extinguish outstanding collection rights. Default, delay or impairment can reduce vehicle value and provider capital; no party promises recovery, insurance or a risk-free spread.',
      'The investor accepts the disclosed discount for earlier payment and gives up the exited portion’s future economic rights. Contract defects, compromised keys, token restrictions, transaction reordering, unavailable infrastructure and network reversals can delay or prevent execution. A displayed quote or signature is not evidence that tokens have arrived; receipt status and wallet balances must substantiate payment.'),
    section('9. ELECTRONIC ACCEPTANCE',consentTerms(a)),
    section('10. DOCUMENT INTEGRITY AND RECORDS',
      'The exact canonical UTF-8 letter is hashed using keccak256. The resulting agreement hash is included in the signed settlement quote alongside the holding, identity, investor, vehicle, route, amounts, maturity, expiry and nonce. The quote’s signing domain identifies the chain and settlement contract. The letter does not embed its own hash, which would be circular; the separate execution record carries it.',
      'Retain the full letter, document reference and version, digest, quote, domain, originator signature, investor signature, typed-name consent and linked transaction receipts. Any alteration of terms requires a new document, hash and signatures. A short summary, email or screen label cannot amend the signed canonical text. The retained record should remain accessible for later comparison and dispute review.'),
    section('11. DRAFTING BASIS AND PRODUCTION REVIEW',lawTerms),
    signer(a,'Typed-name electronic consent followed by the wallet’s EIP-712 settlement-quote signature'),
  ].join('\n\n');
}

/** Includes the deployed policy verbatim; its termsHash and the full letter hash are distinct. */
export function subscriptionAgreementText(a:SubscriptionAgreementInput):string {
  if(a.asset.decimals!==6 || a.amount<=0n) throw new Error('Invalid testnet subscription amount');
  return [
    header(a,'FIRM VEHICLE SUBSCRIPTION LETTER'),parties(a,'Capital provider'),
    section('1. PURPOSE AND SUBSCRIPTION REQUEST',statusTerms,
      `Dear ${a.profile.name}, you request an interest in the identified firm-owned vehicle for the exact contribution below. The firm acts through its registered manager. You provide capital to that vehicle under its mandate; you do not acquire management authority, a deposit account, or direct ownership of every underlying claim.`),
    section('2. SUBSCRIPTION SCHEDULE',
      `Exact subscription: ${money(a.amount,a.asset)}\nSubscription acceptance expires at: ${a.expiresAt}\nAccepted subscription funding expires at: ${a.fundingExpiresAt}\nImmutable vehicle policy hash: ${a.vehicle.termsHash}\nVehicle policy text: reproduced verbatim in Appendix A`,
      'The first deadline limits signing and firm acceptance of this letter. The second is the fixed funding deadline for the on-chain subscription. Signing does not extend either deadline. A fresh amount, wallet, vehicle, token, nonce or deadline requires a fresh document and signature. The exact funding deadline in the accepted subscription must match this letter.'),
    section('3. SETTLEMENT ASSET',assetTerms(a)),
    section('4. IDENTITY AND SUBSCRIPTION ACCEPTANCE',identityTerms,
      'The firm must accept a wallet-bound subscription for the stated identity, exact amount and funding deadline before the provider deposits. Firm acceptance records an allocation request; it is not confirmation that money has been paid or book units issued. The provider separately authorizes any necessary token allowance and the deposit transaction. An allowance is permission for token transfer, not a subscription signature or a completed deposit.'),
    section('5. BOOK INTEREST AND PRICING',
      'On a successful deposit, the vehicle credits nontransferable book units to the provider wallet. If no units exist, the initial base-unit allocation equals the contributed asset base units. Otherwise allocation is the contribution multiplied by existing total units divided by vehicle net asset value, rounded down as the contract specifies. A minimum-unit condition protects the amount accepted for deposit; a changed price that fails that condition requires a fresh review.',
      'The final unit count is established by the confirmed deposit event, not an estimated preview. The demo values vehicle assets as recorded idle cash plus unimpaired outstanding principal. This is an accounting model, not an independent appraisal or a guarantee of realizable value. Income increases value only when recognized through the contract; no fixed yield, interest rate or minimum return is promised. Nontransferable book units cannot be advertised as a freely tradable token or a right to a particular underlying asset.'),
    section('6. USE OF CAPITAL AND FIRM RESPONSIBILITIES',
      'The firm may deploy available vehicle cash for permitted early exits, subject to its registered originator mandates, deal and aggregate limits, exposure caps and liquidity conditions. A purchase route acquires claim rights. A financing route pays the exiting investor, discharges the exited claim portion and leaves a separate originator repayment obligation to the vehicle. In neither route does the exiting investor become the borrower.',
      'The firm controls the vehicle’s permitted management actions and must keep its testnet acceptance, deployment, repayment, impairment and queue records consistent with contract events. Capital may be reserved before settlement and unavailable for withdrawal during that reservation. The provider has no right to direct a particular exit or to treat a quote offered to another participant as a guaranteed return.'),
    section('7. WITHDRAWALS AND THE QUEUE',
      'Immediate withdrawal is available only when no withdrawal queue is open and sufficient unreserved cash covers the requested units at the current contract value. Otherwise the provider may submit a withdrawal request to the first-in, first-out queue. A queued request does not create immediate cash availability, a fixed redemption date or a fixed asset amount.',
      'Queued units remain exposed to changes in vehicle value until filled. Queue processing may fill only part of a request as cash becomes available. Filled units are removed from the book and the resulting asset amount becomes separately claimable; the provider must claim it to receive tokens. Unfilled units remain queued unless cancelled through the permitted contract action. A queue cancellation does not reverse an already filled or claimed amount. Available cash and other participants’ earlier requests affect timing.'),
    section('8. LOSSES, IMPAIRMENT AND RECOVERIES',
      'The provider bears the economic risk of the subscribed vehicle interest, including loss of principal. Originator default, delayed collection, erroneous valuation, operational mistakes or other losses may reduce net asset value. When the contract records an impairment, outstanding principal is reduced and all book units then exposed, including queued but unfilled units, participate in the resulting value change.',
      'The demo records recovery weights using provider book-unit balances at impairment. Later recoveries for that impaired deal are allocated to those recorded beneficiaries and made claimable separately, rather than gifted to later subscribers. Allocations follow contract rounding. Recovery is uncertain; an accounting write-down does not itself waive the vehicle’s collection rights. No withdrawal queue, signature, provider ledger or firm label provides deposit insurance, principal protection or guaranteed redemption.'),
    section('9. TOKEN, TECHNOLOGY AND EXECUTION RISKS',
      'testnet assets are for demonstration and have no promised monetary value. Token restrictions, wallet compromise, lost keys, smart-contract defects, stale state, unavailable services and network reversals can prevent or delay transactions. A firm’s on-chain role is not proof of legal custody arrangements, segregation on insolvency, regulatory supervision or enforceable asset ownership.',
      'The provider should review the wallet’s requested chain, contract, allowance and transaction before authorization. Actual gas is separate from the subscription amount. A rejected or reverted transaction does not issue book units. A transaction broadcast, signing prompt or off-chain status cannot substitute for confirmed contract events. There is no promised unilateral refund or undo of a completed deposit; subsequent liquidity follows the withdrawal provisions.'),
    section('10. ELECTRONIC ACCEPTANCE AND EVIDENCE',consentTerms(a),
      'The wallet signs the complete canonical letter as a personal message. Retain its exact UTF-8 text, separate keccak256 document digest, signature, recovered signer, typed-name acceptance, actual signing timestamp and nonce. The full-letter digest differs from the immutable vehicle policy hash: the former binds this provider and exact subscription, while the latter identifies the deployed common policy. Both are retained with the firm acceptance and deposit evidence.',
      'The deployed policy reproduced in Appendix A is incorporated without alteration. This letter adds the specific subscription and disclosure terms. It cannot silently change the deployed policy or contract behavior. Any discrepancy must be resolved before signing or funding through corrected documents and, where needed, separately authorized contract changes. Preserve the original evidence when creating any replacement.'),
    section('11. DRAFTING BASIS AND PRODUCTION REVIEW',lawTerms),
    signer(a,'Typed-name electronic consent followed by the wallet’s personal-message signature'),
    section('APPENDIX A — IMMUTABLE VEHICLE POLICY (VERBATIM)',a.vehicle.termsText),
  ].join('\n\n');
}
