import { randomBytes } from 'node:crypto';
import { contractTransaction, knownContractTransaction, gasTransaction } from './transactions.js';
import { formatUnits, keccak256, parseEther, parseEventLogs, parseUnits, toHex, verifyTypedData, type Abi, type Address, type Hex } from 'viem';
import { accountAt, artifact, chain, err, identities, identityHash, manifest, paxosMode, publicClient, publicNetwork, terms, walletAt } from './shared.js';
import { demoState, requireBound } from './state.js';
import { newId, profile, save, type OfferRecord, type ReceiptRecord } from './store.js';
import { allHoldings } from './holdings.js';
import { exitAgreementText, subscriptionAgreementText, type LegalAsset, type LegalProfile, type LegalVehicle } from './legal-documents.js';
import { requireExactDocument, requireVerifiedFullName, verifySubscriptionAcceptance } from './agreement-validation.js';

const registryAbi=artifact('DemoRegistry').abi as Abi;
const vaultAbi=artifact('DemoFirmVault').abi as Abi;
const settlementAbi=artifact('DemoSettlement').abi as Abi;
const tokenAbi=artifact('MockUSDG').abi as Abi;
const legalAsset=(m:ReturnType<typeof manifest>):LegalAsset=>({name:paxosMode?'Paxos-issued test USDG':'Lockgate custom TEST USDG',symbol:'USDG',address:m.asset,chainId:chain.id,chainName:publicNetwork?'Arbitrum Sepolia':'Local EVM test network',decimals:6,kind:paxosMode?'paxos-test-usdg':'custom-test-usdg'});
const legalProfile=(identity:typeof identities[number],wallet:Address):LegalProfile=>({id:identity.id,name:identity.name,jurisdiction:identity.jurisdiction,identityRef:identity.identityRef,identityHash:identityHash(identity.identityRef),wallet});
const legalVehicle=(v:ReturnType<typeof manifest>['vaults'][number]):LegalVehicle=>({id:v.id,name:v.name,firm:v.firm,address:v.address,manager:v.manager,termsHash:v.termsHash,termsText:v.termsText});
const quoteTypes={Quote:[
 {name:'holdingId',type:'bytes32'},{name:'vault',type:'address'},{name:'investor',type:'address'},
 {name:'identity',type:'bytes32'},{name:'units',type:'uint256'},{name:'payout',type:'uint256'},
 {name:'repayment',type:'uint256'},{name:'route',type:'uint8'},{name:'deadline',type:'uint64'},
 {name:'maturity',type:'uint64'},{name:'nonce',type:'uint256'},{name:'agreementHash',type:'bytes32'}
]} as const;
const quoteDomain=(settlement:Address)=>({name:'LockgateTestSettlement',version:'1',chainId:chain.id,verifyingContract:settlement} as const);
const tx=contractTransaction;
const asQuote=(q:Record<string,string|number>)=>({holdingId:q.holdingId as Hex,vault:q.vault as Address,investor:q.investor as Address,identity:q.identity as Hex,units:BigInt(q.units),payout:BigInt(q.payout),repayment:BigInt(q.repayment),route:Number(q.route),deadline:BigInt(q.deadline),maturity:BigInt(q.maturity),nonce:BigInt(q.nonce),agreementHash:q.agreementHash as Hex});
const asUiOffer=(r:OfferRecord)=>({id:r.id,vehicleId:r.vehicleId,firm:manifest().vaults.find(v=>v.id===r.vehicleId)?.firm??'',vehicle:manifest().vaults.find(v=>v.id===r.vehicleId)?.name??'',route:Number(r.quote.route)===1?'purchase':'finance',amount:formatUnits(BigInt(r.quote.units),6),payout:formatUnits(BigInt(r.quote.payout),6),fee:formatUnits(BigInt(r.quote.units)-BigInt(r.quote.payout),6),borrowerCharge:Number(r.quote.route)===2?formatUnits(BigInt(r.quote.repayment)-BigInt(r.quote.payout),6):undefined,borrowerDebt:Number(r.quote.route)===2?formatUnits(BigInt(r.quote.repayment),6):undefined,residual:r.residualUnits,expiresAt:new Date(Number(r.quote.deadline)*1000).toISOString(),agreement:r.agreement,quote:r.quote,originatorSignature:r.originatorSignature,investorSignature:r.investorSignature,reserveHash:r.reserveHash});
async function firmReadiness(vault:Address,originator:Address) {
 const m=manifest();
 const [cash,nav,mandate,exposure,capConfigured,capBps,head,tail,approved,active]=await Promise.all([
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'availableCash'}) as Promise<bigint>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'totalAssets'}) as Promise<bigint>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'mandates',args:[originator]}) as Promise<readonly [bigint,bigint,number]>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'exposure',args:[originator]}) as Promise<bigint>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'capConfigured',args:[originator]}) as Promise<boolean>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'capBps',args:[originator]}) as Promise<number>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'queueHead'}) as Promise<bigint>,
  publicClient.readContract({address:vault,abi:vaultAbi,functionName:'queueTail'}) as Promise<bigint>,
  publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'approvedVault',args:[vault]}) as Promise<boolean>,
  publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'isActive',args:[originator,1]}) as Promise<boolean>
 ]);
 const fits=(route:number,payout:bigint)=>approved&&active&&head>tail&&(mandate[2]&route)!==0&&payout>0n&&payout<=cash&&payout<=mandate[1]&&payout+exposure<=mandate[0]&&(!capConfigured||payout+exposure<=nav*BigInt(capBps)/10000n);
 return {mask:mandate[2],fits};
}

export async function createOffers(account:Address,positionId:string,amount:string,forceNew=false) {
 const identity=await requireBound(account),m=manifest(),p=profile(account);
 if(p.role!=='investor'||identity.fixtureCase==='mismatch') err('A matching investor TEST identity is required','INELIGIBLE',403);
 const holding=(await allHoldings()).find(h=>h.id===positionId);
 if(!holding||holding.identity!==identityHash(identity.identityRef)) err('Holding is not attached to this identity','HOLDING_MISMATCH',403);
 const units=parseUnits(amount,6);if(units<=0n) err('Amount must be positive','BAD_AMOUNT');
 const onchain=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'holding',args:[holding.id]}) as {remaining:bigint;locked:bigint;routeMask:number;divisible:boolean};
 if(units>onchain.remaining-onchain.locked) err('Amount exceeds unlocked position','INSUFFICIENT_POSITION',409);
 if(!onchain.divisible&&units!==onchain.remaining) err('This claim can only be exited in full','FULL_EXIT_REQUIRED',409);
 const orgIndex=m.originators.findIndex(o=>o.address.toLowerCase()===holding.originatorAddress.toLowerCase());
 if(orgIndex<0) err('Originator missing','FIXTURE_ERROR',500);
 const chainNow=Number((await publicClient.getBlock()).timestamp);
 const candidates=forceNew?[]:p.offers.filter(o=>!o.cancelled&&(o.agreement.version==='2'||Boolean(o.investorSignature&&o.reserveHash))&&o.account.toLowerCase()===account.toLowerCase()&&o.holdingId===holding.id&&BigInt(o.quote.units)===units&&o.quote.identity===identityHash(identity.identityRef)&&Number(o.quote.deadline)>chainNow);
 const existing=[] as OfferRecord[];
 for(const item of candidates) {
  if(!item.reserveHash){const ready=await firmReadiness(item.quote.vault as Address,holding.originatorAddress);if(ready.fits(Number(item.quote.route),BigInt(item.quote.payout)))existing.push(item);continue;}
  const digest=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'quoteDigest',args:[asQuote(item.quote)]}) as Hex;
  const deal=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'deal',args:[digest]}) as {status:number};
  if(Number(deal.status)===1)existing.push(item);
 }
 if(existing.length) return existing.map(asUiOffer);
 const created=[] as OfferRecord[];
 for(let i=0;i<m.vaults.length;i++) {
  const v=m.vaults[i],ready=await firmReadiness(v.address,holding.originatorAddress);
  const allowed=onchain.routeMask&ready.mask,preferred=i%2?2:1;
  if(!allowed)continue;
  const route=(allowed&preferred?preferred:allowed&1?1:2) as 1|2;
  const payout=units*BigInt([9800,9750,9700,9650,9600][i]-(route===2?100:0))/10000n;
  if(!ready.fits(route,payout)) continue;
  const deadline=BigInt(chainNow+1800), maturity=deadline+30n*24n*3600n;
  const repayment=route===1?units:payout*102n/100n;
  const nonce=BigInt(`0x${randomBytes(8).toString('hex')}`),documentId=newId('EXIT-LETTER');
  const agreementText=exitAgreementText({documentId,version:'2',createdAt:new Date().toISOString(),expiresAt:new Date(Number(deadline)*1000).toISOString(),nonce:String(nonce),profile:legalProfile(identity,account),asset:legalAsset(m),vehicle:legalVehicle(v),holdingId:holding.id,holdingName:holding.name,instrument:holding.instrument,originator:{name:m.originators[orgIndex].name,address:holding.originatorAddress},settlement:m.settlement,route,units,payout,repayment,residualUnits:onchain.remaining-units,maturity:new Date(Number(maturity)*1000).toISOString()});
  const agreementHash=keccak256(toHex(agreementText));
  const q={holdingId:holding.id,vault:v.address,investor:account,identity:identityHash(identity.identityRef),units,payout,repayment,route,deadline,maturity,nonce,agreementHash};
  const signature=await walletAt(orgIndex+1).signTypedData({domain:quoteDomain(m.settlement),types:quoteTypes,primaryType:'Quote',message:q});
  const quote=Object.fromEntries(Object.entries(q).map(([key,value])=>[key,typeof value==='bigint'?String(value):value])) as Record<string,string|number>;
  const record:OfferRecord={id:newId('offer'),account,vehicleId:v.id,holdingId:holding.id,quote,residualUnits:formatUnits(onchain.remaining-units,6),originatorSignature:signature,createdAt:new Date().toISOString(),agreement:{id:documentId,version:'2',title:route===1?'TEST purchase and assignment letter':'TEST financing and claim discharge letter',text:agreementText,digest:agreementHash,signed:false,accepted:false,signerName:identity.name}};
  created.push(record);
 }
 if(!created.length) err('No vehicle has enough available TEST liquidity','NO_LIQUIDITY',409);
 p.offers.push(...created);save();return created.map(asUiOffer);
}

export async function signExit(account:Address,offerId:string,signature:Hex,typedName:string,consent:boolean) {
 const m=manifest(),p=profile(account),r=p.offers.find(o=>o.id===offerId&&o.account.toLowerCase()===account.toLowerCase());
 if(!r) err('Offer not found','NOT_FOUND',404);
 if(r.investorSignature||r.agreement.signed)err('This signed agreement is already recorded','AGREEMENT_ALREADY_SIGNED',409);
 const identity=await requireBound(account);
 requireVerifiedFullName(typedName,identity.name,consent);
 if(r.agreement.version!=='2'||r.quote.identity!==identityHash(identity.identityRef))err('Review a fresh exact exit letter for this identity','TERMS_STALE',409);
 requireExactDocument(r.agreement.text,r.agreement.digest,r.quote.agreementHash as Hex);
 if(!r.reserveHash) err('Reserve the selected offer first','OFFER_NOT_RESERVED',409);
 if(BigInt(r.quote.deadline)<=(await publicClient.getBlock()).timestamp) err('Offer expired','OFFER_EXPIRED',409);
 const valid=await verifyTypedData({address:account,domain:quoteDomain(m.settlement),types:quoteTypes,primaryType:'Quote',message:asQuote(r.quote),signature});
 if(!valid) err('Wallet signature does not match quote','BAD_SIGNATURE',403);
 r.investorSignature=signature;r.signedAt=new Date().toISOString();r.agreement.signed=true;r.agreement.accepted=true;r.agreement.signerName=identity.name;r.agreement.typedName=typedName.trim().replace(/\s+/gu,' ');save();return asUiOffer(r);
}

export async function reserveOffer(account:Address,offerId:string) {
 const identity=await requireBound(account),m=manifest(),p=profile(account),offer=p.offers.find(o=>o.id===offerId&&o.account.toLowerCase()===account.toLowerCase());
 if(!offer) err('Offer not found','NOT_FOUND',404);
 if(offer.agreement.version!=='2'&&!offer.investorSignature)err('Review a fresh exact exit letter before reserving','TERMS_STALE',409);
 if(offer.cancelled) err('Offer was cancelled; request fresh terms','OFFER_CANCELLED',409);
 if(offer.reserveHash) {
  const digest=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'quoteDigest',args:[asQuote(offer.quote)]}) as Hex;
  const deal=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'deal',args:[digest]}) as {status:number};
  if(Number(deal.status)!==1) err('Offer is no longer reserved','OFFER_NOT_ACTIVE',409);
  return asUiOffer(offer);
 }
 if(BigInt(offer.quote.deadline)<=(await publicClient.getBlock()).timestamp) err('Offer expired; request fresh terms','OFFER_EXPIRED',409);
 if(offer.quote.identity!==identityHash(identity.identityRef)) err('Identity changed since quote','IDENTITY_CHANGED',409);
 for(const old of p.offers.filter(o=>o.id!==offer.id&&o.holdingId===offer.holdingId&&o.reserveHash)) {
  const digest=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'quoteDigest',args:[asQuote(old.quote)]}) as Hex;
  const oldDeal=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'deal',args:[digest]}) as {status:number};
  if(Number(oldDeal.status)!==1)continue;
  const oldVault=m.vaults.find(v=>v.id===old.vehicleId);
  if(oldVault) await tx(m.vaults.indexOf(oldVault)+6,m.settlement,settlementAbi,'cancel',[digest]);
  old.reserveHash=undefined;old.cancelled=true;
  save();
 }
 const h=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'holding',args:[offer.holdingId]}) as {remaining:bigint;locked:bigint};
 if(h.remaining-h.locked<BigInt(offer.quote.units)&&!knownContractTransaction(m.vaults.findIndex(v=>v.id===offer.vehicleId)+6,m.settlement,settlementAbi,'reserve',[asQuote(offer.quote),offer.originatorSignature])) err('Position is no longer available','POSITION_CHANGED',409);
 const v=m.vaults.find(x=>x.id===offer.vehicleId);if(!v) err('Firm vehicle missing','FIXTURE_ERROR',500);
 offer.reserveHash=await tx(m.vaults.indexOf(v)+6,m.settlement,settlementAbi,'reserve',[asQuote(offer.quote),offer.originatorSignature]);
 save();return asUiOffer(offer);
}

export async function prepareSubscription(account:Address,vehicleId:string,amount:string) {
 const identity=await requireBound(account),p=profile(account),m=manifest(),v=m.vaults.find(x=>x.id===vehicleId);
 if(p.role!=='provider'||!v) err('Vehicle or provider access unavailable','INELIGIBLE',403);
 const assets=parseUnits(amount,6),minimum=paxosMode?'1':'100',maximum=paxosMode?'100':'100000';
 if(assets<parseUnits(minimum,6)||assets>parseUnits(maximum,6)) err(`Enter ${minimum} to ${maximum} test USDG`,'BAD_AMOUNT');
 const expiresAt=Date.now()+10*60_000,fundingDeadline=(await publicClient.getBlock()).timestamp+3600n;
 const nonce=newId('subscription-nonce'),documentId=newId('SUBSCRIPTION-LETTER');
 const message=subscriptionAgreementText({documentId,version:'2',createdAt:new Date().toISOString(),expiresAt:new Date(expiresAt).toISOString(),fundingExpiresAt:new Date(Number(fundingDeadline)*1000).toISOString(),nonce,profile:legalProfile(identity,account),asset:legalAsset(m),vehicle:legalVehicle(v),amount:assets});
 const digest=keccak256(toHex(message));
 p.pendingSubscriptions??={};p.pendingSubscriptions[vehicleId]={amount,message,digest,expiresAt,fundingDeadline:String(fundingDeadline),documentId,version:'2',signerName:identity.name,termsHash:v.termsHash,vault:v.address};save();
 return {message,digest,vault:v.address,amount,termsHash:v.termsHash,signerName:identity.name,expiresAt:new Date(expiresAt).toISOString(),documentId,version:'2'};
}

export async function acceptSubscription(account:Address,vehicleId:string,amount:string,signature:Hex,typedName:string,consent:boolean,digest:Hex) {
 const identity=await requireBound(account),p=profile(account),m=manifest(),v=m.vaults.find(x=>x.id===vehicleId),pending=p.pendingSubscriptions?.[vehicleId];
 if(p.role!=='provider'||!v||!pending) err('Prepare exact subscription letter again','TERMS_STALE',409);
 const deadline=BigInt(pending.fundingDeadline);
 await verifySubscriptionAcceptance({pending,account,signature,typedName,consent,expectedName:identity.name,amount,digest,vault:v.address,termsHash:v.termsHash,nowMs:Date.now(),chainTimestamp:(await publicClient.getBlock()).timestamp});
 const assets=parseUnits(amount,6);
 const [nav,totalUnits,balance]=await Promise.all([
  publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'totalAssets'}) as Promise<bigint>,
  publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'totalUnits'}) as Promise<bigint>,
  publicClient.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[account]}) as Promise<bigint>
 ]);
 if(balance<assets) err('Wallet needs the exact TEST USDG amount before firm acceptance','INSUFFICIENT_TEST_USDG',409);
 const minUnits=totalUnits===0n?assets:assets*totalUnits/nav;
 const hash=await tx(m.vaults.findIndex(x=>x.id===vehicleId)+6,v.address,vaultAbi,'acceptSubscription',[account,identityHash(identity.identityRef),assets,deadline]);
 const receipt=await publicClient.getTransactionReceipt({hash});
 const events=parseEventLogs({abi:vaultAbi,logs:receipt.logs,eventName:'SubscriptionAccepted'});
 const id=(events[0]?.args as {id?:bigint}|undefined)?.id;
 if(!id) err('Firm acceptance event missing','CHAIN_EVENT_MISSING',500);
 const prior=p.agreements[vehicleId];
 if(prior?.subscriptionId){p.agreementHistory??=[];if(!p.agreementHistory.some(x=>x.vehicleId===vehicleId&&x.agreement.subscriptionId===prior.subscriptionId))p.agreementHistory.push({vehicleId,agreement:prior});}
 p.agreements[vehicleId]={digest,amount,message:pending.message,signature,signedAt:new Date().toISOString(),subscriptionId:String(id),minUnits:String(minUnits),txHash:hash,documentId:pending.documentId,version:pending.version,signerName:identity.name,typedName:typedName.trim().replace(/\s+/gu,' ')};
 delete p.pendingSubscriptions?.[vehicleId];save();
 return {id:String(id),termsHash:v.termsHash,vault:v.address,minUnits:String(minUnits),amount,receipt:{hash,status:'confirmed'}};
}

export async function resumeSubscription(account:Address,vehicleId:string,amount:string){
 const identity=await requireBound(account),m=manifest(),p=profile(account),v=m.vaults.find(x=>x.id===vehicleId),accepted=p.agreements[vehicleId];
 if(p.role!=='provider'||!v||!accepted?.subscriptionId||accepted.amount!==amount)err('No matching accepted subscription to resume','SUBSCRIPTION_NOT_FOUND',404);
 if(!accepted.minUnits)err('Previous subscription needs fresh exact terms','SUBSCRIPTION_REQUOTE',409);
 const record=await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'subscriptions',args:[BigInt(accepted.subscriptionId)]}) as readonly [Address,Hex,bigint,bigint,boolean];
 if(record[0].toLowerCase()!==account.toLowerCase()||record[1]!==identityHash(identity.identityRef)||record[2]!==parseUnits(amount,6))err('Subscription does not match this wallet and identity','SUBSCRIPTION_MISMATCH',403);
 if(record[4]||record[3]<=(await publicClient.getBlock()).timestamp)err('Subscription is funded or expired; sign fresh terms','SUBSCRIPTION_CLOSED',409);
 return {id:accepted.subscriptionId,termsHash:v.termsHash,vault:v.address,minUnits:accepted.minUnits,amount,receipt:accepted.txHash?{hash:accepted.txHash,status:'confirmed'}:undefined};
}

export async function mintPosition(account:Address):Promise<ReceiptRecord> {
 const identity=await requireBound(account),m=manifest(),p=profile(account);
 if(p.role!=='investor'||identity.fixtureCase==='mismatch') err('A matching or empty TEST investor identity is required','ROLE_REQUIRED',403);
 if(p.pendingMint&&p.pendingMint.identityId!==identity.id)err('Resume the pending holding with its original identity','IDENTITY_CHANGED',409);
 const id=p.pendingMint?.id??keccak256(toHex(newId('holding')));
 p.pendingMint={id,identityId:identity.id};save();
 const units=paxosMode?'3':'100000';
 const hash=await tx(1,m.registry,registryAbi,'registerHolding',[id,identityHash(identity.identityRef),parseUnits(units,6),3,true]);
 p.minted.push({id,identityId:identity.id,name:'Alder Private Credit',originator:m.originators[0].name,originatorAddress:m.originators[0].address,units});
 const r:ReceiptRecord={id:newId('receipt'),title:'TEST position registered',status:'confirmed',hash,amount:units,createdAt:new Date().toISOString(),account,detail:'Originator-authorized position issuance'};
 p.receipts.unshift(r);delete p.pendingMint;save();return r;
}

export async function faucet(account:Address):Promise<ReceiptRecord> {
 if(paxosMode)err('Request official test USDG from the Paxos faucet for this wallet','PAXOS_FAUCET_REQUIRED',409);
 const p=profile(account),m=manifest();if(p.faucetHash) err('TEST faucet already used for this wallet','FAUCET_USED',409);
 const amount=parseUnits('10000',6);
 const hash=await tx(0,m.asset,tokenAbi,'mint',[account,amount]);p.faucetHash=hash;
 const r:ReceiptRecord={id:newId('receipt'),title:'TEST USDG funded',status:'confirmed',hash,amount:'10000',createdAt:new Date().toISOString(),account,detail:'Testnet six-decimal ERC20 issuance'};
 p.receipts.unshift(r);save();return r;
}

export async function gasGrant(account:Address):Promise<ReceiptRecord> {
 const p=profile(account);if(p.gasHash) err('Test gas grant already used for this wallet','GAS_USED',409);
 const hash=await gasTransaction(0,account,parseEther(process.env.LOCKGATE_DEMO_NETWORK==='arbitrum-sepolia'?'0.0005':'0.01'));
 p.gasHash=hash;
 const r:ReceiptRecord={id:newId('receipt'),title:'Test gas funded',status:'confirmed',hash,amount:`${process.env.LOCKGATE_DEMO_NETWORK==='arbitrum-sepolia'?'0.0005':'0.01'} ETH`,createdAt:new Date().toISOString(),account,detail:'Test ETH for signing transactions'};
 p.receipts.unshift(r);save();return r;
}
