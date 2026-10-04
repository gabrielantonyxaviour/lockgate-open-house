import { formatUnits, parseUnits, type Address, type Hex } from 'viem';
import { createOffers, prepareSubscription } from './actions.js';
import { requireExactDocument } from './agreement-validation.js';
import { err, identityHash, manifest } from './shared.js';
import { requireBound } from './state.js';
import { profile, save, type DocumentDraft, type OfferRecord, type PendingSubscription, type StoredDocumentDraft } from './store.js';

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const deadline=(value:string)=>Date.parse(value);
const textField=(text:string,label:string,value:string)=>text.split('\n').includes(`${label}: ${value}`);

export function exitDraft(account:Address,identity:Hex,offer:OfferRecord,now=Date.now()):StoredDocumentDraft {
 const q=offer.quote,a=offer.agreement,expiresAt=new Date(Number(q.deadline)*1000).toISOString();
 if(!same(offer.account,account)||!same(String(q.investor),account)||q.identity!==identity)err('This document belongs to another wallet or identity','DOCUMENT_FORBIDDEN',403);
 if(offer.investorSignature||a.signed||a.accepted||offer.cancelled)err('The exit letter can no longer be saved as an unsigned draft','DOCUMENT_UNAVAILABLE',409);
 if(a.version!=='2'||deadline(expiresAt)<=now)err('This exit letter has expired','DOCUMENT_EXPIRED',409);
 requireExactDocument(a.text,a.digest,q.agreementHash as Hex);
 if(!textField(a.text,'Document reference',a.id)||!textField(a.text,'Version',a.version)||!textField(a.text,'Acceptance expires at',expiresAt)||!textField(a.text,'Identity commitment',identity)||!textField(a.text,'Investor wallet',account)||!textField(a.text,'Holding identifier',offer.holdingId)||!textField(a.text,'Vehicle contract',String(q.vault))||!a.text.split('\n').some(line=>line.startsWith('Immediate investor payout: ')&&line.endsWith(`(${q.payout} base units)`))||!a.text.split('\n').some(line=>line.startsWith('Exited claim: ')&&line.includes(`(${q.units} base units; 6 decimals)`)))err('The exit letter differs from its saved terms','DOCUMENT_MISMATCH',409);
 const preparedAt=a.text.match(/^Prepared at: (.+)$/m)?.[1];
 if(!preparedAt||!Number.isFinite(deadline(preparedAt)))err('The exit preparation time is missing','DOCUMENT_MISMATCH',409);
 return {id:a.id,kind:'exit',title:a.title,text:a.text,digest:a.digest,version:a.version,createdAt:preparedAt,expiresAt,positionId:offer.holdingId,vehicleId:offer.vehicleId,amount:formatUnits(BigInt(q.units),6),account,identityHash:identity,offerId:offer.id};
}

export function subscriptionDraft(account:Address,identity:Hex,vehicleId:string,p:PendingSubscription,firm:string,now=Date.now()):StoredDocumentDraft {
 const expiresAt=new Date(p.expiresAt).toISOString();
 if(p.version!=='2'||p.expiresAt<=now)err('This subscription letter has expired','DOCUMENT_EXPIRED',409);
 if(!/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(p.amount))err('The saved subscription amount is invalid','DOCUMENT_MISMATCH',409);
 requireExactDocument(p.message,p.digest,p.digest);
 if(!textField(p.message,'Document reference',p.documentId)||!textField(p.message,'Version',p.version)||!textField(p.message,'Acceptance expires at',expiresAt)||!textField(p.message,'Identity commitment',identity)||!textField(p.message,'Capital provider wallet',account)||!textField(p.message,'Vehicle contract',p.vault)||!p.message.split('\n').some(line=>line.startsWith('Exact subscription: ')&&line.endsWith(`(${parseUnits(p.amount,6)} base units)`)))err('The subscription letter differs from its saved terms','DOCUMENT_MISMATCH',409);
 const preparedAt=p.message.match(/^Prepared at: (.+)$/m)?.[1];
 if(!preparedAt||!Number.isFinite(deadline(preparedAt)))err('The subscription preparation time is missing','DOCUMENT_MISMATCH',409);
 return {id:p.documentId,kind:'subscription',title:`${firm} TEST subscription terms`,text:p.message,digest:p.digest,version:p.version,createdAt:preparedAt,expiresAt,vehicleId,amount:p.amount,account,identityHash:identity};
}

function publicDraft(draft:StoredDocumentDraft):DocumentDraft {
 const {account:_account,identityHash:_identityHash,offerId:_offerId,...view}=draft;
 return view;
}

export function visibleDocumentDrafts(account:Address,identity:Hex|undefined):DocumentDraft[] {
 if(!identity)return [];
 const p=profile(account);
 return (p.documentDrafts??[]).filter(d=>same(d.account,account)&&d.identityHash===identity&&!isSigned(p,d)).map(publicDraft).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

function isSigned(p:ReturnType<typeof profile>,draft:StoredDocumentDraft) {
 return draft.kind==='exit'?p.offers.some(o=>o.agreement.id===draft.id&&Boolean(o.investorSignature||o.agreement.signed||o.agreement.accepted)):[...Object.values(p.agreements),...(p.agreementHistory??[]).map(x=>x.agreement)].some(a=>a.documentId===draft.id);
}

function stored(account:Address,identity:Hex,id:string) {
 const p=profile(account),draft=p.documentDrafts?.find(d=>d.id===id);
 if(!draft||!same(draft.account,account)||draft.identityHash!==identity)err('Saved document not found for this wallet and identity','DOCUMENT_NOT_FOUND',404);
 requireExactDocument(draft.text,draft.digest,draft.digest);
 if(isSigned(p,draft))err('This agreement has already been signed','DOCUMENT_UNAVAILABLE',409);
 return draft;
}

function matchingCurrent(account:Address,identity:Hex,draft:StoredDocumentDraft) {
 const p=profile(account),m=manifest();
 if(draft.kind==='exit'){
  const offer=p.offers.find(o=>o.id===draft.offerId&&o.agreement.id===draft.id);
  if(!offer)err('The original exit offer is no longer available','DOCUMENT_CHANGED',409);
  const current=exitDraft(account,identity,offer);
  if(current.text!==draft.text||current.digest!==draft.digest||current.vehicleId!==draft.vehicleId||current.amount!==draft.amount)err('The exit terms changed; request a fresh document','DOCUMENT_CHANGED',409);
  return {kind:'exit' as const,offer:uiOffer(offer)};
 }
 const v=m.vaults.find(x=>x.id===draft.vehicleId),pending=p.pendingSubscriptions?.[draft.vehicleId];
 if(!v||!pending||pending.documentId!==draft.id)err('The original subscription terms are no longer current','DOCUMENT_CHANGED',409);
 if(pending.termsHash!==v.termsHash||!same(pending.vault,v.address))err('The vehicle terms changed; request a fresh document','DOCUMENT_CHANGED',409);
 const current=subscriptionDraft(account,identity,draft.vehicleId,pending,v.firm);
 if(current.text!==draft.text||current.digest!==draft.digest||current.amount!==draft.amount)err('The subscription terms changed; request a fresh document','DOCUMENT_CHANGED',409);
 return {kind:'subscription' as const,prepared:{message:pending.message,digest:pending.digest,vault:pending.vault,amount:pending.amount,termsHash:pending.termsHash,signerName:pending.signerName,expiresAt:new Date(pending.expiresAt).toISOString(),documentId:pending.documentId,version:'2' as const},vehicleId:draft.vehicleId,amount:draft.amount};
}

function uiOffer(r:OfferRecord) {
 const v=manifest().vaults.find(x=>x.id===r.vehicleId),q=r.quote,units=BigInt(q.units),payout=BigInt(q.payout),repayment=BigInt(q.repayment);
 return {id:r.id,positionId:r.holdingId,vehicleId:r.vehicleId,firm:v?.firm??'',vehicle:v?.name??'',route:Number(q.route)===1?'purchase' as const:'finance' as const,amount:formatUnits(units,6),payout:formatUnits(payout,6),fee:formatUnits(units-payout,6),borrowerCharge:Number(q.route)===2?formatUnits(repayment-payout,6):undefined,borrowerDebt:Number(q.route)===2?formatUnits(repayment,6):undefined,residual:r.residualUnits,expiresAt:new Date(Number(q.deadline)*1000).toISOString(),agreement:r.agreement,quote:q,originatorSignature:r.originatorSignature,investorSignature:r.investorSignature,reserveHash:r.reserveHash};
}

export async function saveDocumentDraft(account:Address,kind:'exit'|'subscription',id:string) {
 const identity=await requireBound(account),p=profile(account),hash=identityHash(identity.identityRef),m=manifest();
 let draft:StoredDocumentDraft;
 if(kind==='exit'){
  if(p.role!=='investor')err('Investor role required','ROLE_REQUIRED',403);
  const offer=p.offers.find(o=>o.agreement.id===id);
  if(!offer)err('Exit letter not found','DOCUMENT_NOT_FOUND',404);
  if(!m.vaults.some(v=>v.id===offer.vehicleId))err('Exit vehicle is unavailable','DOCUMENT_CHANGED',409);
  draft=exitDraft(account,hash,offer);
 }else{
  if(p.role!=='provider')err('Capital provider role required','ROLE_REQUIRED',403);
  const entry=Object.entries(p.pendingSubscriptions??{}).find(([,pending])=>pending.documentId===id);
  if(!entry)err('Subscription letter not found','DOCUMENT_NOT_FOUND',404);
  const [vehicleId,pending]=entry,v=m.vaults.find(x=>x.id===vehicleId);
  if(!v||!same(pending.vault,v.address)||pending.termsHash!==v.termsHash||pending.signerName!==identity.name)err('Vehicle or identity terms changed','DOCUMENT_CHANGED',409);
  draft=subscriptionDraft(account,hash,vehicleId,pending,v.firm);
 }
 p.documentDrafts??=[];
 const prior=p.documentDrafts.find(d=>d.id===draft.id);
 if(prior&&JSON.stringify(prior)!==JSON.stringify(draft))err('This document reference already has different terms','DOCUMENT_CHANGED',409);
 if(!prior){p.documentDrafts.unshift(draft);save();}
 return publicDraft(prior??draft);
}

export async function resumeDocumentDraft(account:Address,id:string) {
 const identity=await requireBound(account),draft=stored(account,identityHash(identity.identityRef),id);
 if(deadline(draft.expiresAt)<=Date.now())err('This document has expired; request fresh terms','DOCUMENT_EXPIRED',409);
 if(profile(account).role!==(draft.kind==='exit'?'investor':'provider'))err('Switch to the document’s role before continuing','ROLE_REQUIRED',403);
 return matchingCurrent(account,identityHash(identity.identityRef),draft);
}

export async function renewDocumentDraft(account:Address,id:string) {
 const identity=await requireBound(account),hash=identityHash(identity.identityRef),draft=stored(account,hash,id),p=profile(account);
 if(p.role!==(draft.kind==='exit'?'investor':'provider'))err('Switch to the document’s role before continuing','ROLE_REQUIRED',403);
 if(draft.kind==='subscription'){
  const prepared=await prepareSubscription(account,draft.vehicleId,draft.amount);
  return {kind:'subscription' as const,prepared,vehicleId:draft.vehicleId,amount:draft.amount};
 }
 if(!draft.positionId)err('Saved exit position is missing','DOCUMENT_CHANGED',409);
 const offers=await createOffers(account,draft.positionId,draft.amount,true);
 const offer=offers.find(o=>o.vehicleId===draft.vehicleId&&o.agreement.id!==draft.id);
 if(!offer)err('The selected vehicle cannot provide fresh terms; choose from available offers','NO_LIQUIDITY',409);
 return {kind:'exit' as const,offer};
}
