import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { exitAgreementText, subscriptionAgreementText, type LegalDocumentInput } from '../src/demo/legal-documents.js';
import { exitDraft, subscriptionDraft } from '../src/demo/document-drafts.js';
import type { OfferRecord, PendingSubscription } from '../src/demo/store.js';

const wallet='0x1111111111111111111111111111111111111111' as Address;
const other='0x2222222222222222222222222222222222222222' as Address;
const vault='0x3333333333333333333333333333333333333333' as Address;
const hash=(value:string)=>keccak256(toHex(value));
const identity=hash('TEST-IDENTITY-002');
const createdAt='2026-10-04T12:00:00.000Z';
const expiresAt='2026-10-04T12:30:00.000Z';
const common:LegalDocumentInput={documentId:'EXIT-LETTER-abcdef123456',version:'2',createdAt,expiresAt,nonce:'1234',profile:{id:'priya-menon',name:'Priya Menon',jurisdiction:'India',identityRef:'TEST-IDENTITY-002',identityHash:identity,wallet},asset:{name:'Lockgate custom TEST USDG',symbol:'USDG',address:other,chainId:421614,chainName:'Arbitrum Sepolia',decimals:6,kind:'custom-test-usdg'},vehicle:{id:'firm-1',name:'Northstar vehicle',firm:'Northstar Investment Firm',address:vault,manager:other,termsHash:hash('policy'),termsText:'Exact TEST vehicle policy.'}};

function exit():OfferRecord {
 const holdingId=hash('holding');
 const text=exitAgreementText({...common,holdingId,holdingName:'Alder Private Credit',instrument:'Term loan note',originator:{name:'Alder Credit Platform',address:other},settlement:other,route:1,units:1_000_000n,payout:980_000n,repayment:1_000_000n,residualUnits:0n,maturity:'2026-11-04T12:30:00.000Z'});
 return {id:'offer-abcdef123456',account:wallet,vehicleId:'firm-1',holdingId,quote:{holdingId,vault,investor:wallet,identity,units:'1000000',payout:'980000',repayment:'1000000',route:1,deadline:String(Date.parse(expiresAt)/1000),maturity:String(Date.parse('2026-11-04T12:30:00.000Z')/1000),nonce:'1234',agreementHash:hash(text)},residualUnits:'0',originatorSignature:'0x1234',createdAt,agreement:{id:common.documentId,version:'2',title:'TEST purchase and assignment letter',text,digest:hash(text),signed:false,accepted:false}};
}

function subscription():PendingSubscription {
 const fields={...common,documentId:'SUBSCRIPTION-LETTER-abcdef123456',expiresAt:'2026-10-04T12:10:00.000Z'};
 const message=subscriptionAgreementText({...fields,amount:1_000_000_000n,fundingExpiresAt:'2026-10-04T13:00:00.000Z'});
 return {amount:'1000',message,digest:hash(message),expiresAt:Date.parse(fields.expiresAt),fundingDeadline:String(Date.parse('2026-10-04T13:00:00.000Z')/1000),documentId:fields.documentId,version:'2',signerName:'Priya Menon',termsHash:common.vehicle.termsHash,vault};
}

test('unsigned exit draft preserves exact text and rejects signed, cross-wallet, changed, and expired offers',()=>{
 const offer=exit(),now=Date.parse(createdAt)+1000;
 const draft=exitDraft(wallet,identity,offer,now);
 assert.equal(draft.text,offer.agreement.text);assert.equal(draft.digest,offer.agreement.digest);assert.equal(draft.positionId,offer.holdingId);assert.equal(draft.amount,'1');
 assert.throws(()=>exitDraft(other,identity,offer,now),{code:'DOCUMENT_FORBIDDEN'});
 assert.throws(()=>exitDraft(wallet,hash('other identity'),offer,now),{code:'DOCUMENT_FORBIDDEN'});
 assert.throws(()=>exitDraft(wallet,identity,{...offer,agreement:{...offer.agreement,signed:true}},now),{code:'DOCUMENT_UNAVAILABLE'});
 assert.throws(()=>exitDraft(wallet,identity,{...offer,quote:{...offer.quote,payout:'970000'}},now),{code:'DOCUMENT_MISMATCH'});
 assert.throws(()=>exitDraft(wallet,identity,{...offer,agreement:{...offer.agreement,text:offer.agreement.text+' '}},now),{code:'DOCUMENT_MISMATCH'});
 assert.throws(()=>exitDraft(wallet,identity,offer,Date.parse(expiresAt)),{code:'DOCUMENT_EXPIRED'});
});

test('unsigned subscription draft binds text, amount, wallet and expiry',()=>{
 const pending=subscription(),now=Date.parse(createdAt)+1000;
 const draft=subscriptionDraft(wallet,identity,'firm-1',pending,common.vehicle.firm,now);
 assert.equal(draft.createdAt,createdAt);assert.equal(draft.amount,'1000');assert.equal(draft.digest,pending.digest);
 assert.throws(()=>subscriptionDraft(other,identity,'firm-1',pending,common.vehicle.firm,now),{code:'DOCUMENT_MISMATCH'});
 assert.throws(()=>subscriptionDraft(wallet,identity,'firm-1',{...pending,amount:'1001'},common.vehicle.firm,now),{code:'DOCUMENT_MISMATCH'});
 assert.throws(()=>subscriptionDraft(wallet,identity,'firm-1',{...pending,digest:hash('changed')},common.vehicle.firm,now),{code:'DOCUMENT_MISMATCH'});
 assert.throws(()=>subscriptionDraft(wallet,identity,'firm-1',pending,common.vehicle.firm,pending.expiresAt),{code:'DOCUMENT_EXPIRED'});
});
