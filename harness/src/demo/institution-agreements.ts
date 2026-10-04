import { type Abi, type Address, type Hex } from 'viem';
import { artifact, manifest, publicClient, type Manifest } from './shared.js';
import { institutionScope, type InstitutionScope } from './institution-representatives.js';
import { storedProfiles, type ProfileRecord, type SubscriptionAgreement } from './store.js';

export type InstitutionAgreement={id:string;title:string;version:string;text:string;digest:Hex;
 signedAt?:string;signerName?:string;status:string;receiptId?:string};
type StoredProfile={account:Address;profile:ProfileRecord};
type SubscriptionState={provider:Address;funded:boolean};
type Readers={holdingOriginator:(id:Hex)=>Promise<Address>;
 subscription:(vault:Address,id:string)=>Promise<SubscriptionState>};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const zero='0x0000000000000000000000000000000000000000';

/** Selects only exact signed documents involving the representative's existing on-chain institution. */
export async function selectInstitutionAgreements(scope:InstitutionScope,m:Manifest,profiles:StoredProfile[],readers:Readers):Promise<InstitutionAgreement[]> {
 const results:InstitutionAgreement[]=[],seenIds=new Set<string>(),seenDigests=new Set<string>();
 const add=(item:InstitutionAgreement)=>{
  if(!item.id||!item.text||!item.digest||seenIds.has(item.id)||seenDigests.has(item.digest.toLowerCase()))return;
  seenIds.add(item.id);seenDigests.add(item.digest.toLowerCase());results.push(item);
 };
 const relevantVaults=m.vaults.filter(v=>scope.role==='manager'&&same(v.manager,scope.actor));
 const vaultById=new Map(relevantVaults.map(v=>[v.id,v]));
 const signedSubscriptions:{account:Address;vehicleId:string;agreement:SubscriptionAgreement}[]=[];
 for(const {account,profile} of profiles){
  for(const offer of profile.offers){
   if(!same(offer.account,account)||!same(String(offer.quote.holdingId),offer.holdingId)||
    !offer.investorSignature||!(offer.agreement.signed||offer.agreement.accepted))continue;
   if(!m.vaults.some(v=>v.id===offer.vehicleId&&same(v.address,String(offer.quote.vault))))continue;
   const included=scope.role==='manager'
    ?relevantVaults.some(v=>v.id===offer.vehicleId&&same(v.address,String(offer.quote.vault)))
    :same(await readers.holdingOriginator(offer.holdingId),scope.actor);
   if(!included)continue;
   add({id:offer.agreement.id,version:offer.agreement.version,title:offer.agreement.title,
    text:offer.agreement.text,digest:offer.agreement.digest,signedAt:offer.signedAt,
    signerName:offer.agreement.signerName,status:'Signed TEST exit agreement',receiptId:offer.reserveHash});
  }
  if(scope.role!=='manager')continue;
  for(const [vehicleId,agreement] of Object.entries(profile.agreements))
   if(vaultById.has(vehicleId))signedSubscriptions.push({account,vehicleId,agreement});
  for(const item of profile.agreementHistory??[])
   if(vaultById.has(item.vehicleId))signedSubscriptions.push({account,vehicleId:item.vehicleId,agreement:item.agreement});
 }
 for(const {account,vehicleId,agreement} of signedSubscriptions){
  const vault=vaultById.get(vehicleId)!;
  if(!agreement.message||!agreement.signature||!agreement.subscriptionId)continue;
  const chain=await readers.subscription(vault.address,agreement.subscriptionId);
  if(!same(chain.provider,account)||same(chain.provider,zero))continue;
  add({id:agreement.documentId??`agreement-${vehicleId}-${agreement.subscriptionId}`,
   title:`${vault.firm} TEST subscription terms`,version:agreement.version??'1',text:agreement.message,
   digest:agreement.digest,signedAt:agreement.signedAt,signerName:agreement.signerName,
   status:chain.funded?'Funded TEST subscription':'Firm accepted TEST subscription',receiptId:agreement.txHash});
 }
 return results.sort((a,b)=>(Date.parse(b.signedAt??'')||0)-(Date.parse(a.signedAt??'')||0));
}

export async function institutionAgreements(account:Address):Promise<InstitutionAgreement[]> {
 const m=manifest(),scope=institutionScope(account,m);
 if(!scope)return [];
 const registryAbi=artifact('DemoRegistry').abi as Abi,vaultAbi=artifact('DemoFirmVault').abi as Abi;
 const readers:Readers={
  holdingOriginator:async id=>{
   const holding=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'holding',args:[id]}) as {originator:Address};
   return holding.originator;
  },
  subscription:async(vault,id)=>{
   const record=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'subscriptions',args:[BigInt(id)]}) as readonly [Address,Hex,bigint,bigint,boolean];
   return {provider:record[0],funded:record[4]};
  }
 };
 return selectInstitutionAgreements(scope,m,storedProfiles(),readers);
}
