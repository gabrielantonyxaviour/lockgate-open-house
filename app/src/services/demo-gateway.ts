import { createPublicClient, http, keccak256, stringToHex, parseAbi, parseUnits, type Address, type Hex, type Abi } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { z } from 'zod';
import { authorizedWallet, getProvider, walletChainId } from '../chain/wallet';
import type { DemoGateway, DemoRole, DemoState, Enquiry, EnquiryReceipt, Offer, Receipt } from '../demo/types';
import { clearPending, pending, rememberPending } from './demo-pending';
import { DemoTransport, configuration, identityResponse, quoteSchema, receiptSchema, stateSchema, subscriptionResponse, type Configuration, type Quote } from './demo-transport';
const registryAbi=parseAbi(['function bindIdentity(bytes32 identity,uint64 validUntil,uint256 nonce,bytes signature)']);
const assetAbi=parseAbi(['function approve(address spender,uint256 amount) returns (bool)','function allowance(address owner,address spender) view returns (uint256)']);
const vaultAbi=parseAbi(['function deposit(uint256 id,bytes32 acceptedTerms,uint256 minUnits) returns (uint256)','function withdraw(uint256 units) returns (uint256)','function claim()','function processQueue(uint256 maxRequests)','function cancelWithdrawal(uint256 id)','function requestWithdrawal(uint256 units) returns (uint256)','function bookUnits(address) view returns (uint256)','function queuedUnits(address) view returns (uint256)','function totalUnits() view returns (uint256)','function totalAssets() view returns (uint256)','function availableCash() view returns (uint256)','function queueHead() view returns (uint256)','function queueTail() view returns (uint256)']);
const settlementAbi=parseAbi(['function cancel(bytes32 digest)','function settle((bytes32 holdingId,address vault,address investor,bytes32 identity,uint256 units,uint256 payout,uint256 repayment,uint8 route,uint64 deadline,uint64 maturity,uint256 nonce,bytes32 agreementHash) q,bytes investorSignature)']);
const quoteFields=[{name:'holdingId',type:'bytes32'},{name:'vault',type:'address'},{name:'investor',type:'address'},{name:'identity',type:'bytes32'},{name:'units',type:'uint256'},{name:'payout',type:'uint256'},{name:'repayment',type:'uint256'},{name:'route',type:'uint8'},{name:'deadline',type:'uint64'},{name:'maturity',type:'uint64'},{name:'nonce',type:'uint256'},{name:'agreementHash',type:'bytes32'}] as const;
type SignedOffer=Offer & {quote:Quote;signature?:Hex};
class Gateway implements DemoGateway {
 private api=new DemoTransport();
 async publicOverview() {return z.object({originators:z.number().int().nonnegative(),firms:z.number().int().nonnegative(),availableCash:z.string(),outstanding:z.string(),environment:z.string(),platforms:z.array(z.object({id:z.string(),name:z.string(),instrument:z.string(),routes:z.array(z.string()),terms:z.string(),status:z.string()})).optional()}).parse(await this.api.request('public'));}
 private account?:Address;
 private config?:Configuration;
 private state?:DemoState;
 private signed=new Map<string,SignedOffer>();
 private subscriptions=new Map<string,{amount:string;data:z.infer<typeof subscriptionResponse>}>();
 private async setup() { return this.config??=configuration.parse(await this.api.request('config')); }
 private async wallet(allowPending=false) { if(this.account&&!allowPending&&pending(this.account).length) throw new Error('A submitted transaction still needs reconciliation. Refresh its status before another action.'); if(!this.account) throw new Error('Connect your wallet first.'); const config=await this.setup();const wallet=await authorizedWallet(this.account);
  const [expected,actual]=await Promise.all([this.client(config).getBlock({blockNumber:0n}),getProvider().request({method:'eth_getBlockByNumber',params:['0x0',false]})]);
  if(!actual||actual.hash?.toLowerCase()!==expected.hash?.toLowerCase())throw new Error('Your wallet RPC does not match this Arbitrum Sepolia deployment. Select public Arbitrum Sepolia in your wallet before continuing. No transaction was sent.');
  return wallet; }
 private async readState() {
  const config=await this.setup();
  for(const item of this.account?pending(this.account):[]) {
   try {const mined=await this.client(config).getTransactionReceipt({hash:item.hash!});if(mined){await this.api.request('receipts',{hash:item.hash,title:item.title,amount:item.amount});clearPending(item.hash!);}}catch{/* Keep the original hash until authoritative reconciliation. */}
  }
  this.state=stateSchema.parse(await this.api.request('state')) as DemoState;
  if(this.account)this.state.receipts=[...pending(this.account),...this.state.receipts];return this.state;
 }
 private client(config:Configuration) {return createPublicClient({chain:arbitrumSepolia,pollingInterval:1000,transport:http(config.rpcUrl,{batch:{wait:10},timeout:15_000})});}
 private async record(hash:Hex,title:string,amount?:string):Promise<Receipt> {
  const config=await this.setup();
  const unknown=rememberPending(this.account!,hash,title,amount);
  let receipt;
  try {receipt=await this.client(config).waitForTransactionReceipt({hash,timeout:60_000,confirmations:config.network==='Arbitrum Sepolia'?3:1});}catch{return unknown;}
  if(receipt.status!=='success') {await this.api.request('receipts',{hash,title,amount});clearPending(hash);throw new Error(`Transaction reverted: ${hash}`);}
  const result=receiptSchema.parse(await this.api.request('receipts',{hash,title,amount}));
  if(result.status!=='confirmed') throw new Error('The transaction is mined; the service has not reconciled it yet. Refresh before retrying.');
  clearPending(hash);await this.readState(); return result as Receipt;
 }
 async authenticate(account:Address,chainId:number) {
  this.account=account; this.api.token=undefined; this.signed.clear(); this.subscriptions.clear();
  if(chainId!==421614) throw new Error('Select Arbitrum Sepolia to use the demo.');
  const challenge=z.object({message:z.string(),nonce:z.string()}).parse(await this.api.request('challenge',{account,chainId}));
  const signature=await (await this.wallet(true)).signMessage({message:challenge.message});
  const session=z.object({token:z.string(),state:stateSchema}).parse(await this.api.request('authenticate',{account,chainId,...challenge,signature}));
  this.api.token=session.token; this.state=session.state as DemoState; return this.state;
 }
 async refresh(account:Address,chainId:number) {
  if(chainId!==421614) throw new Error('Select Arbitrum Sepolia to use the demo.');
  if(this.account?.toLowerCase()!==account.toLowerCase() || !this.api.token) return this.authenticate(account,chainId);
  if(await walletChainId()!==421614) throw new Error('Your wallet network changed. Select Arbitrum Sepolia.');
  return this.readState();
 }
 async selectRole(role:DemoRole) {await this.api.request('role',{role}); return this.readState();}
 async selectIdentity(profileId:string) {
  const data=identityResponse.parse(await this.api.request('identity',{profileId}));
  const wallet=await this.wallet();
  const hash=await wallet.writeContract({address:data.registry as Address,abi:registryAbi,functionName:'bindIdentity',args:[data.identity as Hex,data.validUntil,data.nonce,data.signature as Hex]});
  await this.record(hash,'Identity linked'); return this.readState();
 }
 async enquire(enquiry:Enquiry) {
  return z.object({reference:z.string(),receivedAt:z.string(),emailStatus:z.string()}).parse(await this.api.request('enquiries',{...enquiry,requestId:keccak256(stringToHex(JSON.stringify({...enquiry,account:this.account})))})) as EnquiryReceipt;
 }
 async offers(positionId:string,amount:string) {
  const raw=z.array(z.object({id:z.string(),quote:quoteSchema}).passthrough()).parse(await this.api.request('offers',{positionId,amount}));
  return raw.map(item=>{const offer=item as unknown as SignedOffer; this.signed.set(offer.id,offer);return offer;});
 }
 async signExit(offer:Offer) {
  let item=this.signed.get(offer.id); if(!item) throw new Error('Refresh this offer before signing.');
  const reserved=z.object({id:z.string(),quote:quoteSchema}).passthrough().parse(await this.api.request('reserve-offer',{offerId:offer.id}));
  const next=reserved as unknown as SignedOffer;
  const serialize=(q:Quote)=>JSON.stringify(q,(_,v)=>typeof v==='bigint'?v.toString():v);
  if(serialize(next.quote)!==serialize(item.quote))throw new Error('The reserved terms changed. Review a fresh offer before signing.');
  item=next;this.signed.set(item.id,item);
  if(keccak256(stringToHex(item.agreement.text))!==item.quote.agreementHash||item.agreement.digest!==item.quote.agreementHash||parseUnits(offer.payout,6)!==item.quote.payout||parseUnits(offer.amount,6)!==item.quote.units)throw new Error('The displayed agreement does not match the wallet quote. No signature was requested.');
  const config=await this.setup();
  const signature=await (await this.wallet()).signTypedData({domain:{name:'LockgateTestSettlement',version:'1',chainId:421614,verifyingContract:config.settlement as Address},types:{Quote:quoteFields},primaryType:'Quote',message:item.quote});
  const updated=await this.api.request<Offer>('exit-signature',{offerId:offer.id,signature});
  this.signed.set(offer.id,{...updated,quote:item.quote,signature}); return updated;
 }
 async settleExit(offer:Offer) {
  const item=this.signed.get(offer.id); if(!item?.signature) throw new Error('Sign this exact exit agreement first.');
  const config=await this.setup(); const wallet=await this.wallet();
  const hash=await wallet.writeContract({address:config.settlement as Address,abi:settlementAbi,functionName:'settle',args:[item.quote,item.signature]});
  this.signed.delete(offer.id); return this.record(hash,'Early payout received',offer.payout);
 }
 async releaseReservation(digest:Hex) {const config=await this.setup();const wallet=await this.wallet();const hash=await wallet.writeContract({address:config.settlement as Address,abi:settlementAbi,functionName:'cancel',args:[digest]});return this.record(hash,'Unused exit reservation released');}
 async checkEligibility(vehicleId:string) {await this.api.request('eligibility',{vehicleId}); return this.readState();}
 async signSubscription(vehicleId:string,amount:string) {
  parseUnits(amount,6);
  const prepared=z.object({message:z.string(),digest:z.string(),vault:z.string(),amount:z.string()}).parse(await this.api.request('subscription',{vehicleId,amount}));
  const current=await this.readState();const vehicle=current.vehicles.find(v=>v.id===vehicleId);
  const policy=(vehicle as typeof vehicle & {policyText?:string})?.policyText;
  if(keccak256(stringToHex(prepared.message))!==prepared.digest||prepared.amount!==amount||vehicle?.address?.toLowerCase()!==prepared.vault.toLowerCase()||!prepared.message.includes(this.account!)||(policy&&!prepared.message.includes(policy)))throw new Error('Subscription terms changed. Review them again before signing.');
  const signature=await (await this.wallet()).signMessage({message:prepared.message});
  const data=subscriptionResponse.parse(await this.api.request('subscription',{vehicleId,amount,signature}));
  this.subscriptions.set(vehicleId,{amount,data}); return this.readState();
 }
 async fund(vehicleId:string,amount:string) {
  let subscription=this.subscriptions.get(vehicleId);
  if(!subscription){const data=subscriptionResponse.parse(await this.api.request('subscription-resume',{vehicleId,amount}));subscription={amount,data};this.subscriptions.set(vehicleId,subscription);}
  if(parseUnits(subscription.amount,6)!==parseUnits(amount,6))throw new Error('Sign the subscription for this exact amount first.');
  const config=await this.setup(); const wallet=await this.wallet(); const vault=subscription.data.vault as Address; const assets=parseUnits(amount,6);
  const allowance=await this.client(config).readContract({address:config.asset as Address,abi:assetAbi,functionName:'allowance',args:[this.account!,vault]});
  if(allowance<assets) { const approval=await wallet.writeContract({address:config.asset as Address,abi:assetAbi,functionName:'approve',args:[vault,assets]}); const approved=await this.record(approval,'USDG spending approved',amount);if(approved.status!=='confirmed')return approved; }
  const hash=await wallet.writeContract({address:vault,abi:vaultAbi,functionName:'deposit',args:[subscription.data.id,subscription.data.termsHash as Hex,subscription.data.minUnits]});
  this.subscriptions.delete(vehicleId); return this.record(hash,'Vehicle funded',amount);
 }
 async withdraw(vehicleId:string,amount:string) {
  const state=await this.readState(); const vehicle=state.vehicles.find(v=>v.id===vehicleId); if(!vehicle?.address) throw new Error('Select an available vehicle.');
  const config=await this.setup(); const client=this.client(config); const vault=vehicle.address; const wallet=await this.wallet();
  const [totalUnits,nav,cash,head,tail]=await Promise.all(['totalUnits','totalAssets','availableCash','queueHead','queueTail'].map(functionName=>client.readContract({address:vault,abi:vaultAbi,functionName:functionName as 'totalUnits'|'totalAssets'|'availableCash'|'queueHead'|'queueTail'})));
  const assets=parseUnits(amount,6); if(assets<=0n || nav===0n) throw new Error('Enter a positive amount within your balance.');
  const units=(assets*totalUnits+nav-1n)/nav;
  const queued=assets>cash || head<=tail;
  const hash=await wallet.writeContract({address:vault,abi:vaultAbi,functionName:queued?'requestWithdrawal':'withdraw',args:[units]});
  return this.record(hash,queued?'Withdrawal requested':'Withdrawal received',amount);
 }
 async providerAction(vehicleId:string,action:'claim'|'processQueue'|'cancel',requestId?:string) {
  const state=await this.readState();const vehicle=state.vehicles.find(v=>v.id===vehicleId);if(!vehicle?.address)throw new Error('Select an available vehicle.');
  const wallet=await this.wallet();const functionName=action==='claim'?'claim':action==='processQueue'?'processQueue':'cancelWithdrawal';
  const args:readonly []|readonly [bigint]=action==='claim'?[]:action==='processQueue'?[10n]:[BigInt(requestId||'0')];
  const hash=await wallet.writeContract({address:vehicle.address,abi:vaultAbi,functionName,args});
  return this.record(hash,action==='claim'?'Queued withdrawal received':action==='cancel'?'Unfilled withdrawal cancelled':'Withdrawal queue checked');
 }
 async mintPosition() {const result=receiptSchema.parse(await this.api.request('mint-position',{}));await this.readState();return result as Receipt;}
 async getTestGas() {const result=receiptSchema.parse(await this.api.request('gas',{}));await this.readState();return result as Receipt;}
 async getTestUsdg() {const result=receiptSchema.parse(await this.api.request('faucet',{}));await this.readState();return result as Receipt;}
 async workspaceAction(actionId:string,inputs:Record<string,string>) {
  const intent=z.object({title:z.string(),amount:z.string().optional(),transactions:z.array(z.object({address:z.string().regex(/^0x[\da-f]{40}$/i),abi:z.array(z.record(z.string(),z.unknown())),functionName:z.string(),args:z.array(z.unknown())})).min(1).max(3)}).parse(await this.api.request('workspace-action',{actionId,inputs}));
  const wallet=await this.wallet(); let result:Receipt|undefined;
  for(const tx of intent.transactions) {
   const args=tx.args.map(value=>typeof value==='string' && /^\d+$/.test(value)?BigInt(value):value);
   const hash=await wallet.writeContract({address:tx.address as Address,abi:tx.abi as unknown as Abi,functionName:tx.functionName,args});
   result=await this.record(hash,intent.title,intent.amount);if(result.status!=='confirmed')return result;
  }
  return result!;
 }
}
export function createDemoGateway():DemoGateway {return new Gateway();}
