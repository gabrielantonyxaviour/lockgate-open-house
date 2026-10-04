import type { Address, Hex } from 'viem';
export type DemoRole = 'investor' | 'originator' | 'manager' | 'provider';
export type Identity = { id:string; name:string; jurisdiction:string; identityRef:string; fixtureCase:'match'|'mismatch'|'empty' };
export type Profile = { identity?:Identity; roles:DemoRole[]; activeRole?:DemoRole; onboarding?:string; organization?:string };
export type Position = { id:string; name:string; originator:string; instrument:string; available:string; faceValue:string; partial:boolean; restriction?:string };
export type Offer = { id:string; vehicleId:string; firm:string; vehicle:string; route:'purchase'|'finance'; amount:string; payout:string; fee:string; residual:string; expiresAt:string; agreement:Agreement };
export type Agreement = { id:string; version:string; title:string; text:string; digest:Hex; signed:boolean; accepted:boolean; funded?:boolean; amount?:string };
export type AgreementRecord = {id:string;title:string;version:string;text:string;digest:Hex;signedAt?:string;status:string;receiptId?:string};
export type Reservation = {digest:Hex;positionId:string;units:string;payout:string;expiresAt:string;firm:string};
export type Vehicle = { id:string; name:string; firm:string; cash:string; nav:string; policy:string; policyText?:string; policyHash?:Hex; policyVersion?:string; minimum:string; eligible:boolean; eligibilityStatus:string; agreement?:Agreement; providerPrincipal?:string; providerNav?:string; income?:string; loss?:string; withdrawable?:string; queued?:string; claimable?:string; withdrawals?:{id:string;amount:string;cancelable:boolean}[]; address?:Address };
export type Receipt = { id:string; title:string; status:'submitted'|'confirmed'|'reverted'|'unknown'; hash?:Hex; explorerUrl?:string; amount?:string; residual?:string; createdAt:string; account:Address; detail?:string };
export type Workspace = { title:string; organization:string; status:string; checks:{label:string; status:string}[]; records:{id:string; label:string; value:string}[]; actions?:WorkspaceAction[] };
export type WorkspaceAction = { id:string; label:string; description:string; kind:'register'|'repay'|'mandate'|'approve'; fields:{key:string; label:string; value?:string; type:'text'|'amount'; required:boolean; options?:{value:string;label:string}[]}[]; disabledReason?:string };
export type PublicOverview = { originators:number; firms:number; availableCash:string; outstanding:string; environment:string; platforms?:{id:string;name:string;instrument:string;routes:string[];terms:string;status:string}[] };
export type DemoState = { environment?:string; profile:Profile; positions:Position[]; positionStatus:'matched'|'empty'|'mismatch'|'unavailable'; vehicles:Vehicle[]; receipts:Receipt[]; agreements?:AgreementRecord[]; reservations?:Reservation[]; workspace?:Workspace; setup:{gas:string; usdg:string; canMint:boolean; canFund:boolean; canGetGas?:boolean; gasAmount?:string; gasFaucetUrl?:string; mintDescription?:string; fundingAmount?:string; message?:string}; deploymentReady:boolean };
export type Enquiry = { role:'originator'|'manager'; representative:string; email:string; organization:string; jurisdiction:string; summary:string };
export type EnquiryReceipt = { reference:string; receivedAt:string; emailStatus:string };
/** Adapter must authenticate private reads and return authoritative receipt-backed results. */
export interface DemoGateway {
 publicOverview():Promise<PublicOverview>;
 authenticate(account:Address, chainId:number):Promise<DemoState>;
 refresh(account:Address, chainId:number):Promise<DemoState>;
 selectRole(role:DemoRole):Promise<DemoState>;
 selectIdentity(profileId:string,onBound?:()=>void):Promise<DemoState>;
 enquire(enquiry:Enquiry):Promise<EnquiryReceipt>;
 offers(positionId:string, amount:string):Promise<Offer[]>;
 signExit(offer:Offer):Promise<Offer>;
 settleExit(offer:Offer):Promise<Receipt>;
 releaseReservation(digest:Hex):Promise<Receipt>;
 checkEligibility(vehicleId:string):Promise<DemoState>;
 signSubscription(vehicleId:string, amount:string):Promise<DemoState>;
 fund(vehicleId:string, amount:string):Promise<Receipt>;
 providerAction(vehicleId:string,action:'claim'|'processQueue'|'cancel',requestId?:string):Promise<Receipt>;
 withdraw(vehicleId:string, amount:string):Promise<Receipt>;
 workspaceAction(actionId:string, inputs:Record<string,string>):Promise<Receipt>;
 mintPosition():Promise<Receipt>;
 getTestGas():Promise<Receipt>;
 getTestUsdg():Promise<Receipt>;
}
