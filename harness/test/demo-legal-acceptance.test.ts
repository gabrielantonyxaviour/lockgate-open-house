import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { requireExactDocument, requireVerifiedFullName, verifySubscriptionAcceptance } from '../src/demo/agreement-validation.js';
import { exitAgreementText, subscriptionAgreementText, type LegalDocumentInput } from '../src/demo/legal-documents.js';

const actor=privateKeyToAccount(generatePrivateKey());
const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as Address;
const hash=(s:string)=>keccak256(toHex(s));
const common:LegalDocumentInput={
 documentId:'SUBSCRIPTION-LETTER-EXAMPLE',version:'2',createdAt:'2026-10-04T12:00:00.000Z',expiresAt:'2026-10-04T12:10:00.000Z',nonce:'subscription-nonce-example',
 profile:{id:'priya-menon',name:'Priya Menon',jurisdiction:'India',identityRef:'TEST-IDENTITY-002',identityHash:hash('TEST-IDENTITY-002'),wallet:actor.address},
 asset:{name:'Lockgate custom TEST USDG',symbol:'USDG',address:address(100),chainId:421614,chainName:'Arbitrum Sepolia',decimals:6,kind:'custom-test-usdg'},
 vehicle:{id:'firm-1',name:'Northstar Investment Firm Liquidity Vehicle',firm:'Northstar Investment Firm',address:address(101),manager:address(102),termsHash:hash('policy'),termsText:'Exact deployed policy paragraph one.\n\nExact paragraph two.'}
};

test('typed full name is bound to the verified profile and affirmative consent',()=>{
 assert.doesNotThrow(()=>requireVerifiedFullName('  PRIYA   MENON  ','Priya Menon',true));
 for(const [name,consent] of [['Priya',true],['Alex Morgan',true],['Priya Menon',false]] as const){
  assert.throws(()=>requireVerifiedFullName(name,'Priya Menon',consent),{code:'SIGNER_NAME_MISMATCH'});
 }
});

test('exit letter hash changes with actual route and cannot be accepted after text alteration',()=>{
 const fields={...common,documentId:'EXIT-LETTER-EXAMPLE',holdingId:hash('holding'),holdingName:'Alder Private Credit',instrument:'Term loan note',originator:{name:'Alder Credit Platform',address:address(103)},settlement:address(104),units:2_000_000n,payout:1_930_000n,repayment:1_968_600n,residualUnits:1_000_000n,maturity:'2026-11-04T12:00:00.000Z'};
 const financed=exitAgreementText({...fields,route:2}),purchased=exitAgreementText({...fields,route:1});
 assert.match(financed,/Priya Menon/);assert.match(financed,/1\.93 Lockgate custom TEST USDG/);
 assert.match(financed,/Originator financing charge/);assert.notEqual(hash(financed),hash(purchased));
 assert.doesNotThrow(()=>requireExactDocument(financed,hash(financed),hash(financed)));
 assert.throws(()=>requireExactDocument(financed+' ',hash(financed),hash(financed)),{code:'DOCUMENT_MISMATCH'});
});

test('exact subscription letter includes verbatim immutable policy and frozen funding deadline',()=>{
 const message=subscriptionAgreementText({...common,amount:10_000_000n,fundingExpiresAt:'2026-10-04T13:00:00.000Z'});
 assert.ok(message.endsWith(common.vehicle.termsText));
 assert.match(message,/2026-10-04T13:00:00.000Z/);
 assert.match(message,/10 Lockgate custom TEST USDG/);
 assert.match(message,/Required typed full name: Priya Menon/);
 assert.notEqual(hash(message),common.vehicle.termsHash);
});

test('subscription acceptance rejects stale, tampered, wrong-name and wrong-wallet packages',async()=>{
 const message=subscriptionAgreementText({...common,amount:10_000_000n,fundingExpiresAt:'2026-10-04T13:00:00.000Z'});
 const digest=hash(message),signature=await actor.signMessage({message});
 const pending={amount:'10',message,digest,expiresAt:Date.parse(common.expiresAt),fundingDeadline:String(Date.parse('2026-10-04T13:00:00.000Z')/1000),documentId:common.documentId,version:'2',signerName:'Priya Menon',termsHash:common.vehicle.termsHash,vault:common.vehicle.address};
 const valid={pending,account:actor.address,signature,typedName:'Priya Menon',consent:true,expectedName:'Priya Menon',amount:'10',digest,vault:common.vehicle.address,termsHash:common.vehicle.termsHash,nowMs:Date.parse('2026-10-04T12:05:00.000Z'),chainTimestamp:BigInt(Date.parse('2026-10-04T12:05:00.000Z')/1000)};
 await assert.doesNotReject(()=>verifySubscriptionAcceptance(valid));
 for(const override of [{typedName:'Priya'}, {consent:false}])await assert.rejects(()=>verifySubscriptionAcceptance({...valid,...override}),{code:'SIGNER_NAME_MISMATCH'});
 for(const override of [{digest:hash(message+' changed')},{pending:{...pending,message:message+' changed'}},{termsHash:hash('other policy')}])await assert.rejects(()=>verifySubscriptionAcceptance({...valid,...override}),{code:'DOCUMENT_MISMATCH'});
 await assert.rejects(()=>verifySubscriptionAcceptance({...valid,nowMs:pending.expiresAt}),{code:'TERMS_STALE'});
 await assert.rejects(()=>verifySubscriptionAcceptance({...valid,chainTimestamp:BigInt(pending.fundingDeadline)}),{code:'TERMS_STALE'});
 await assert.rejects(()=>verifySubscriptionAcceptance({...valid,account:address(999)}),{code:'BAD_SIGNATURE'});
});
