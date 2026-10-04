import { formatEther, formatUnits, parseUnits, type Abi, type Address, type Hex } from 'viem';
import { artifact, identities, identityHash, manifest, publicClient, err, paxosMode } from './shared.js';
import { profile, type ReceiptRecord } from './store.js';
import { completedRoles } from './profile-roles.js';
import { workspaceState } from './workspace.js';
import { allHoldings } from './holdings.js';
import { providerLedger } from './provider-ledger.js';
import { classifyReceipt } from './receipt-classifier.js';
import { visibleDocumentDrafts } from './document-drafts.js';

const publicNetwork=process.env.LOCKGATE_DEMO_NETWORK==='arbitrum-sepolia';
const environment=publicNetwork?'Arbitrum Sepolia':'Local EVM test network';
const gasAmount=publicNetwork?'0.0005':'0.01';
const registryAbi=artifact('DemoRegistry').abi as Abi;
const vaultAbi=artifact('DemoFirmVault').abi as Abi;
const tokenAbi=artifact('MockUSDG').abi as Abi;
const settlementAbi=artifact('DemoSettlement').abi as Abi;
const read=async(address:Address,abi:Abi,functionName:string,args:readonly unknown[]=[])=>publicClient.readContract({address,abi,functionName,args});
const money=(value:unknown)=>formatUnits(BigInt(value as bigint),6);

export async function requireBound(account:Address) {
 const p=profile(account), identity=identities.find(i=>i.id===p.identityId);
 if(!identity) err('Select a TEST identity first','IDENTITY_REQUIRED',403);
 const ok=await read(manifest().registry,registryAbi,'matches',[account,identityHash(identity.identityRef)]);
 if(!ok) err('Bind the selected TEST identity with your wallet first','IDENTITY_NOT_BOUND',403);
 return identity;
}

export async function demoState(account:Address) {
 const m=manifest(),p=profile(account),identity=identities.find(i=>i.id===p.identityId);
 const binding=identity?await read(m.registry,registryAbi,'matches',[account,identityHash(identity.identityRef)]):false;
 // Before identity verification, onboarding needs wallet balances, not every vault's history.
 const institution=m.originators.some(o=>o.address.toLowerCase()===account.toLowerCase())||m.vaults.some(v=>v.manager.toLowerCase()===account.toLowerCase());
 if(!binding&&!institution){
  const [gas,usdg]=await Promise.all([publicClient.getBalance({address:account}),read(m.asset,tokenAbi,'balanceOf',[account])]);
  return {profile:{identity:undefined,roles:completedRoles(p,Boolean(binding)),activeRole:p.role,onboarding:p.role?'Select and bind a TEST identity':undefined},positions:[],positionStatus:'unavailable',vehicles:[],withdrawals:[],reservations:[],agreements:[],documentDrafts:[],receipts:p.receipts,workspace:undefined,setup:{gas:formatEther(gas),usdg:money(usdg),canGetGas:!p.gasHash,canGetUsdg:!paxosMode&&!p.faucetHash,gasAmount,canMint:false,canFund:false,mintDescription:`${paxosMode?'3':'100,000'} TEST units in Alder Private Credit, recorded to your bound identity`,fundingAmount:paxosMode?undefined:'10000',message:publicNetwork?'Transactions settle on Arbitrum Sepolia.':'Local EVM test network.'},deploymentReady:true,environment};
 }
 const heldIdentity=identity?.fixtureCase!=='mismatch'&&identity&&binding?identityHash(identity.identityRef):undefined;
 const holdings=heldIdentity?(await allHoldings()).filter(h=>h.identity===heldIdentity):[];
 const positions=[] as Record<string,unknown>[];
 const withdrawals=[] as {id:string;vehicleId:string;requestId:string;units:string;amount:string;cancelable:boolean}[];
 const reservations=[] as {digest:Hex;offerId:string;positionId:Hex;units:string;payout:string;expiresAt:string;firm:string}[];
 const agreements=[] as {id:string;version:string;title:string;text:string;digest:Hex;signedAt?:string;signerName?:string;status:string;receiptId?:string}[];
 if(binding&&identity)await Promise.all(p.offers.map(async offer=>{
  if(offer.account.toLowerCase()!==account.toLowerCase()||offer.quote.identity!==identityHash(identity.identityRef))return;
  if(offer.agreement.signed||offer.agreement.accepted)agreements.push({id:offer.agreement.id,version:offer.agreement.version,title:offer.agreement.title,text:offer.agreement.text,digest:offer.agreement.digest,signedAt:offer.signedAt,signerName:offer.agreement.signerName,status:'Signed TEST exit agreement',receiptId:offer.reserveHash});
  if(!offer.reserveHash)return;
  const q=offer.quote;
  const args={holdingId:q.holdingId,vault:q.vault,investor:q.investor,identity:q.identity,units:BigInt(q.units),payout:BigInt(q.payout),repayment:BigInt(q.repayment),route:Number(q.route),deadline:BigInt(q.deadline),maturity:BigInt(q.maturity),nonce:BigInt(q.nonce),agreementHash:q.agreementHash};
  const digest=await read(m.settlement,settlementAbi,'quoteDigest',[args]) as Hex;
  const deal=await read(m.settlement,settlementAbi,'deal',[digest]) as {status:number};
  if(Number(deal.status)===1)reservations.push({digest,offerId:offer.id,positionId:offer.holdingId,units:money(q.units),payout:money(q.payout),expiresAt:new Date(Number(q.deadline)*1000).toISOString(),firm:m.vaults.find(v=>v.id===offer.vehicleId)?.firm??'TEST firm'});
 }));
 await Promise.all((p.agreementHistory??[]).map(async item=>{
  const v=m.vaults.find(x=>x.id===item.vehicleId),a=item.agreement;
  if(!v||!a.message||!a.subscriptionId)return;
  const record=await read(v.address,vaultAbi,'subscriptions',[BigInt(a.subscriptionId)]) as readonly [Address,Hex,bigint,bigint,boolean];
  if(record[0].toLowerCase()!==account.toLowerCase())return;
  agreements.push({id:a.documentId??`agreement-${v.id}-${a.subscriptionId}`,version:a.version??'1',title:`${v.firm} TEST subscription terms`,text:a.message,digest:a.digest,signedAt:a.signedAt,signerName:a.signerName,status:record[4]?'Funded TEST subscription':'Firm accepted TEST subscription',receiptId:a.txHash});
 }));
 positions.push(...await Promise.all(holdings.map(async h=> {
  const chainHolding=await read(m.registry,registryAbi,'holding',[h.id]) as {remaining:bigint;locked:bigint;divisible:boolean};
  const remaining=chainHolding.remaining,locked=chainHolding.locked;
  return {id:h.id,name:h.name,originator:h.originator,instrument:h.instrument,available:money(remaining-locked),faceValue:money(remaining),partial:chainHolding.divisible};
 })));
 // Exit offers are fetched separately; an investor refresh does not replay provider books.
 const vehicles=p.role==='investor'?[]:await Promise.all(m.vaults.map(async v=>{
  const [cash,totalAssets,totalUnits,bookUnits,queuedUnits,claimable,queueHead,queueTail]=await Promise.all([
   read(v.address,vaultAbi,'availableCash'),read(v.address,vaultAbi,'totalAssets'),read(v.address,vaultAbi,'totalUnits'),
   read(v.address,vaultAbi,'bookUnits',[account]),read(v.address,vaultAbi,'queuedUnits',[account]),read(v.address,vaultAbi,'claimable',[account]),
   read(v.address,vaultAbi,'queueHead'),read(v.address,vaultAbi,'queueTail')
  ]);
  const units=BigInt(bookUnits as bigint),all=BigInt(totalUnits as bigint),nav=BigInt(totalAssets as bigint);
  const ledger=await providerLedger(v.address,account,units,nav,all),unqueued=units-BigInt(queuedUnits as bigint);
  const queueOpen=BigInt(queueHead as bigint)<=BigInt(queueTail as bigint),cashAvailable=BigInt(cash as bigint);
  const withdrawable=queueOpen?0n:(all?unqueued*nav/all:0n);
  const queuedRequests=[] as {id:string;units:string}[];
  for(let id=1n;id<=BigInt(queueTail as bigint);id++) {
   const request=await read(v.address,vaultAbi,'withdrawals',[id]) as readonly [Address,bigint];
   if(request[0].toLowerCase()===account.toLowerCase()&&request[1]>0n){
    const estimate=all?request[1]*nav/all:0n;
    queuedRequests.push({id:String(id),units:money(request[1])});
    withdrawals.push({id:`${v.id}:${id}`,vehicleId:v.id,requestId:String(id),units:money(request[1]),amount:money(estimate),cancelable:true});
   }
  }
  const eligible=Boolean(binding && p.role==='provider');
  const accepted=p.agreements[v.id];
  const subscription=accepted?.subscriptionId?await read(v.address,vaultAbi,'subscriptions',[BigInt(accepted.subscriptionId)]) as readonly [Address,Hex,bigint,bigint,boolean]:undefined;
  const funded=Boolean(subscription?.[4]);
  if(accepted?.message)agreements.push({id:accepted.documentId??`agreement-${v.id}-${accepted.subscriptionId??'pending'}`,version:accepted.version??'1',title:`${v.firm} TEST subscription terms`,text:accepted.message,digest:accepted.digest,signedAt:accepted.signedAt,signerName:accepted.signerName,status:funded?'Funded TEST subscription':'Firm accepted TEST subscription',receiptId:accepted.txHash});
  return {id:v.id,name:v.name,firm:v.firm,cash:money(cash),nav:money(totalAssets),policy:'TEST firm mandate · both exit routes',policyText:v.termsText,policyHash:v.termsHash,policyVersion:'1',minimum:paxosMode?'1':'100',eligible,eligibilityStatus:eligible?'TEST identity bound; firm acceptance is amount-specific.':'Connect and bind an eligible TEST identity.',agreement:{id:accepted?.documentId??`agreement-${v.id}`,version:accepted?.version??'1',title:`${v.firm} TEST subscription terms`,text:accepted?.message??v.termsText,digest:accepted?.digest??v.termsHash,signed:Boolean(accepted),accepted:Boolean(accepted?.subscriptionId),funded,amount:accepted?.amount,signerName:accepted?.signerName},providerPrincipal:money(ledger.principal),providerNav:money(ledger.nav),income:money(ledger.income),loss:money(ledger.loss),withdrawable:money(withdrawable<cashAvailable?withdrawable:cashAvailable),queued:money(all?BigInt(queuedUnits as bigint)*nav/all:0n),address:v.address,claimable:money(claimable),queuedRequests,withdrawals:queuedRequests.map(q=>({id:q.id,amount:withdrawals.find(x=>x.vehicleId===v.id&&x.requestId===q.id)?.amount??'0',cancelable:true})),queueOpen};
 }));
 const [gas,usdg]=await Promise.all([publicClient.getBalance({address:account}),read(m.asset,tokenAbi,'balanceOf',[account])]);
 const profileView={identity:binding?identity:undefined,roles:completedRoles(p,Boolean(binding)),activeRole:p.role,onboarding:binding?'TEST identity bound':p.role?'Select and bind a TEST identity':undefined};
 const status=!binding?'unavailable':identity?.fixtureCase==='mismatch'?'mismatch':positions.length?'matched':'empty';
 const workspace=await workspaceState(account);
 return {profile:profileView,positions,positionStatus:status,vehicles,withdrawals,reservations,agreements,documentDrafts:visibleDocumentDrafts(account,binding&&identity?identityHash(identity.identityRef):undefined),receipts:p.receipts,workspace,setup:{gas:formatEther(gas),usdg:money(usdg),canGetGas:!p.gasHash,canGetUsdg:!paxosMode&&!p.faucetHash,gasAmount,canMint:Boolean(binding&&p.role==='investor'&&identity?.fixtureCase!=='mismatch'),canFund:Boolean(binding&&p.role==='provider'),mintDescription:`${paxosMode?'3':'100,000'} TEST units in Alder Private Credit, recorded to your bound identity`,fundingAmount:paxosMode?undefined:'10000',message:publicNetwork?'Transactions settle on Arbitrum Sepolia.':'Local EVM test network.'},deploymentReady:true,environment};
}

export async function publicStats(){
 const m=manifest();
 const [platforms,vaults,block]=await Promise.all([
  Promise.all(m.originators.map(async(o,index)=>{
   const sample=m.holdings.find(h=>h.originatorAddress.toLowerCase()===o.address.toLowerCase());
   const [active,holding]=await Promise.all([
    read(m.registry,registryAbi,'isActive',[o.address,1]),
    sample?read(m.registry,registryAbi,'holding',[sample.id]) as Promise<{routeMask:number}>:undefined
   ]);
   const mask=holding?.routeMask??0;
   return {id:`platform-${index+1}`,name:o.name,instrument:sample?.instrument??'TEST fund claim',routes:[...(mask&1?['purchase']:[]),...(mask&2?['finance']:[])],terms:'Claim rights and settlement routes are recorded on Arbitrum Sepolia.',status:active?'Active TEST':'Inactive'};
  })),
  Promise.all(m.vaults.map(async v=>{
   const [active,approved,cash,principal]=await Promise.all([
    read(m.registry,registryAbi,'isActive',[v.manager,2]),read(m.registry,registryAbi,'approvedVault',[v.address]),
    read(v.address,vaultAbi,'availableCash'),read(v.address,vaultAbi,'outstandingPrincipal')
   ]);
   return {approved:Boolean(active&&approved),cash:BigInt(cash as bigint),principal:BigInt(principal as bigint)};
  })),
  publicClient.getBlock()
 ]);
 return {originators:platforms.filter(p=>p.status==='Active TEST').length,firms:vaults.filter(v=>v.approved).length,platforms,availableCash:money(vaults.reduce((sum,v)=>sum+v.cash,0n)),outstanding:money(vaults.reduce((sum,v)=>sum+v.principal,0n)),blockNumber:String(block.number),blockTime:new Date(Number(block.timestamp)*1000).toISOString(),environment,terms:'Testnet instruments and six-decimal test assets.'};
}

export async function receiptFromHash(account:Address,hash:Hex,_title:string,_amount?:string):Promise<ReceiptRecord> {
 const m=manifest();
 let tx;try{tx=await publicClient.getTransaction({hash});}catch{err('Transaction was not found on this network','TX_NOT_FOUND',404);}
 const allowed=new Set([m.asset.toLowerCase(),m.registry.toLowerCase(),m.settlement.toLowerCase(),...m.vaults.map(v=>v.address.toLowerCase())]);
 if(tx.from.toLowerCase()!==account.toLowerCase()||!tx.to||!allowed.has(tx.to.toLowerCase())) err('Transaction does not belong to this account and demo','UNRELATED_TRANSACTION',403);
 let mined;try{mined=await publicClient.getTransactionReceipt({hash});}catch{
  const p=profile(account),prior=p.receipts.find(x=>x.hash===hash);
  const pending:ReceiptRecord={id:hash,title:'Transaction submitted',status:'submitted',hash,createdAt:prior?.createdAt??new Date().toISOString(),account,detail:'Awaiting a network receipt.'};
  if(prior)Object.assign(prior,pending);else p.receipts.unshift(pending);
  return pending;
 }
 const classified=await classifyReceipt(tx,mined,m);
 const p=profile(account),prior=p.receipts.find(x=>x.hash===hash);
 const r:ReceiptRecord={id:hash,...classified,status:mined.status==='success'?'confirmed':'reverted',hash,createdAt:prior?.createdAt??new Date().toISOString(),account};
 if(prior)Object.assign(prior,r);else p.receipts.unshift(r);
 return r;
}
