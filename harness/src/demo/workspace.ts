import { isAddress, parseEventLogs, parseUnits, formatUnits, keccak256, toHex, type Abi, type Address, type Hex } from 'viem';
import { artifact, err, identityHash, identities, manifest, publicClient } from './shared.js';
import { allHoldings } from './holdings.js';
import { profile } from './store.js';

const registryAbi=artifact('DemoRegistry').abi as Abi;
const settlementAbi=artifact('DemoSettlement').abi as Abi;
const vaultAbi=artifact('DemoFirmVault').abi as Abi;
const tokenAbi=artifact('MockUSDG').abi as Abi;
const parseAmount=(value:string|undefined)=>{if(!value||!/^\d{1,9}(\.\d{1,6})?$/.test(value))err('Enter a valid six-decimal amount','BAD_AMOUNT');return parseUnits(value,6);};
type Field={key:string;label:string;value?:string;type:'text'|'amount';required:boolean;options?:{value:string;label:string}[]};
type Action={id:string;label:string;description:string;kind:'register'|'repay'|'mandate'|'approve';fields:Field[];disabledReason?:string};
const routeText=(mask:number)=>mask===3?'Purchase + finance':mask===1?'Purchase':mask===2?'Finance':'No routes';

async function activeObligations(account:Address) {
 const m=manifest(),logs=await publicClient.getLogs({address:m.settlement,fromBlock:0n,toBlock:'latest'});
 const settled=parseEventLogs({abi:settlementAbi,logs,eventName:'Settled',strict:false});
 const claims=await allHoldings();
 const deals=await Promise.all(settled.map(async event=>{
  const digest=(event.args as {digest:Hex}).digest;
  const deal=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'deal',args:[digest]}) as {quote:{holdingId:Hex;repayment:bigint;route:number};originator:Address;paid:bigint;status:number};
  if(deal.originator.toLowerCase()!==account.toLowerCase()||Number(deal.status)!==2)return undefined;
  const due=deal.quote.repayment-deal.paid;
  if(due<=0n)return undefined;
  const claim=claims.find(h=>h.id.toLowerCase()===deal.quote.holdingId.toLowerCase());
  return {digest,label:`${formatUnits(due,6)} TEST USDG due · ${routeText(Number(deal.quote.route))} · ${claim?.name??'TEST claim'}`};
 }));
 return deals.filter((item):item is {digest:Hex;label:string}=>Boolean(item));
}

async function mandateRecords(vault:Address) {
 const m=manifest();
 return Promise.all(m.originators.map(async originator=>{
  const [mandate,configured,bps,exposure]=await Promise.all([
   publicClient.readContract({address:vault,abi:vaultAbi,functionName:'mandates',args:[originator.address]}) as Promise<readonly [bigint,bigint,number]>,
   publicClient.readContract({address:vault,abi:vaultAbi,functionName:'capConfigured',args:[originator.address]}) as Promise<boolean>,
   publicClient.readContract({address:vault,abi:vaultAbi,functionName:'capBps',args:[originator.address]}) as Promise<number>,
   publicClient.readContract({address:vault,abi:vaultAbi,functionName:'exposure',args:[originator.address]}) as Promise<bigint>
  ]);
  const pct=configured?`${Number(bps)/100}% of current NAV`:'NAV percentage cap not set';
  return {id:`mandate-${originator.address}`,label:originator.name,value:`${pct} · ${formatUnits(mandate[1],6)} TEST USDG per deal · ${routeText(Number(mandate[2]))} · ${formatUnits(exposure,6)} TEST USDG used`};
 }));
}

export async function workspaceState(account:Address) {
 const m=manifest();
 const org=m.originators.find(o=>o.address.toLowerCase()===account.toLowerCase());
 const vault=m.vaults.find(v=>v.manager.toLowerCase()===account.toLowerCase());
 if(org) {
  const active=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'isActive',args:[account,1]}) as boolean;
  const holdings=(await allHoldings()).filter(h=>h.originatorAddress.toLowerCase()===account.toLowerCase());
  const obligations=await activeObligations(account);
  const records=[] as {id:string;label:string;value:string}[];
  for(const h of holdings) {
   const state=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'holding',args:[h.id]}) as {remaining:bigint};
   records.push({id:h.id,label:h.name,value:`${formatUnits(state.remaining,6)} TEST units remaining`});
  }
  records.push(...obligations.map(o=>({id:o.digest,label:'Exit obligation',value:o.label})));
  const actions:Action[]=[
   {id:'originator.register-holding',label:'Register TEST holding',description:'Record an exact position against a listed TEST investor identity.',kind:'register',fields:[{key:'profileId',label:'TEST profile ID',type:'text',required:true},{key:'units',label:'Units',type:'amount',required:true},{key:'routeMask',label:'Routes (1 purchase, 2 finance, 3 both)',type:'text',required:true},{key:'divisible',label:'Divisible (true/false)',type:'text',required:true}]},
   {id:'originator.repay',label:'Repay an exit obligation',description:'Approve exact test USDG and repay the selected on-chain deal.',kind:'repay',fields:[{key:'digest',label:'Exit obligation',type:'text',required:true,options:obligations.map(o=>({value:o.digest,label:o.label}))}],disabledReason:obligations.length?'':'No active exit obligations'}
  ];
  return {title:'Originator workspace',organization:org.name,status:active?'Active TEST organization':'Inactive',checks:[{label:'On-chain organization invitation',status:active?'Active':'Not active'},{label:'Claims recorded',status:String(holdings.length)}],records,actions};
 }
 if(vault) {
  const [active,nav,cash,principal]=await Promise.all([
   publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'isActive',args:[account,2]}),
   publicClient.readContract({address:vault.address,abi:vaultAbi,functionName:'totalAssets'}),
   publicClient.readContract({address:vault.address,abi:vaultAbi,functionName:'availableCash'}),
   publicClient.readContract({address:vault.address,abi:vaultAbi,functionName:'outstandingPrincipal'})
  ]);
  const actions:Action[]=[
   {id:'manager.set-mandate',label:'Set risk mandate',description:'Cap one originator as a percent of live vehicle NAV; choose deal limit and allowed routes.',kind:'mandate',fields:[{key:'originatorAddress',label:'Originator',type:'text',required:true,options:m.originators.map(o=>({value:o.address,label:o.name}))},{key:'exposurePercent',label:'Maximum exposure (% of NAV)',type:'amount',required:true},{key:'dealLimit',label:'Per-deal limit (test USDG)',type:'amount',required:true},{key:'routeMask',label:'Routes (1 purchase, 2 finance, 3 both)',type:'text',required:true}]},
   {id:'manager.process-queue',label:'Process withdrawal queue',description:'Fill requests using current available cash and live NAV.',kind:'approve',fields:[{key:'maxRequests',label:'Maximum requests (1–50)',type:'text',required:true}]}
  ];
  const approved=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'approvedVault',args:[vault.address]});
  const mandates=await mandateRecords(vault.address);
  return {title:'Investment firm workspace',organization:vault.firm,status:active?'Active TEST firm':'Inactive',
   checks:[{label:'On-chain firm invitation',status:active?'Active':'Not active'},{label:'Vault approved',status:String(approved)}],
   records:[{id:'vault',label:'Vehicle',value:vault.address},{id:'nav',label:'Net asset value',value:`${formatUnits(BigInt(nav as bigint),6)} test USDG`},
    {id:'cash',label:'Available cash',value:`${formatUnits(BigInt(cash as bigint),6)} test USDG`},{id:'principal',label:'Outstanding principal',value:`${formatUnits(BigInt(principal as bigint),6)} test USDG`},...mandates],actions};
 }
 return undefined;
}

export async function workspaceAction(account:Address,actionId:string,inputs:Record<string,string>) {
 const m=manifest(),org=m.originators.find(o=>o.address.toLowerCase()===account.toLowerCase()),vault=m.vaults.find(v=>v.manager.toLowerCase()===account.toLowerCase());
 const tx=(title:string,transactions:{address:Address;abi:Abi;functionName:string;args:unknown[]}[],amount?:string)=>({title,amount,transactions});
 if(actionId.startsWith('provider.')) {
  const p=profile(account),identity=identities.find(i=>i.id===p.identityId),v=m.vaults.find(x=>x.id===inputs.vehicleId);
  if(p.role!=='provider'||!identity||!v) err('Provider identity and vehicle required','ROLE_REQUIRED',403);
  const matched=await publicClient.readContract({address:m.registry,abi:registryAbi,functionName:'matches',args:[account,identityHash(identity.identityRef)]});
  if(!matched) err('Bind selected TEST identity with wallet','IDENTITY_NOT_BOUND',403);
  if(actionId==='provider.claim') {
   const claimable=BigInt(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'claimable',args:[account]}) as bigint);
   if(claimable<=0n) err('No filled withdrawal is claimable','NOT_CLAIMABLE',409);
   return tx('Claim filled withdrawal',[{address:v.address,abi:vaultAbi,functionName:'claim',args:[]}],formatUnits(claimable,6));
  }
  if(actionId==='provider.process-queue') {
   const head=BigInt(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'queueHead'}) as bigint);
   const tail=BigInt(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'queueTail'}) as bigint);
   if(head>tail) err('No withdrawal queue is open','QUEUE_EMPTY',409);
   return tx('Process withdrawal queue',[{address:v.address,abi:vaultAbi,functionName:'processQueue',args:[50]}]);
  }
  if(actionId==='provider.cancel-withdrawal') {
   if(!/^\d{1,12}$/.test(inputs.requestId??''))err('Select a withdrawal request','BAD_REQUEST');
   const id=BigInt(inputs.requestId);if(id<=0n) err('Select a withdrawal request','BAD_REQUEST');
   const request=await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'withdrawals',args:[id]}) as readonly [Address,bigint];
   if(request[0].toLowerCase()!==account.toLowerCase()||request[1]<=0n) err('Withdrawal request is not yours or already filled','REQUEST_FORBIDDEN',403);
   return tx('Cancel queued withdrawal',[{address:v.address,abi:vaultAbi,functionName:'cancelWithdrawal',args:[String(id)]}]);
  }
 }
 if(actionId==='originator.register-holding'&&org) {
  const identity=identities.find(x=>x.id===inputs.profileId);if(!identity) err('Choose a listed TEST profile','UNKNOWN_IDENTITY');
  const units=parseAmount(inputs.units),mask=Number(inputs.routeMask);
  if(units<=0n||units>parseUnits('1000000',6)||![1,2,3].includes(mask)||!['true','false'].includes(inputs.divisible)) err('Invalid holding terms','INVALID_INPUT');
  const id=keccak256(toHex(`TEST-ORG-HOLDING-${account}-${Date.now()}-${crypto.randomUUID()}`));
  return {...tx('Register TEST holding',[{address:m.registry,abi:registryAbi,functionName:'registerHolding',args:[id,identityHash(identity.identityRef),String(units),mask,inputs.divisible==='true']}]),holding:{id,profileId:identity.id,units:inputs.units}};
 }
 if(actionId==='originator.repay'&&org) {
  const digest=inputs.digest as Hex;if(!/^0x[0-9a-fA-F]{64}$/.test(digest??'')) err('Enter a deal digest','INVALID_INPUT');
  const deal=await publicClient.readContract({address:m.settlement,abi:settlementAbi,functionName:'deal',args:[digest]}) as {quote:{repayment:bigint;vault:Address};originator:Address;paid:bigint;status:number};
  const quote=deal.quote,originator=deal.originator,paid=deal.paid,status=Number(deal.status);
  if(originator.toLowerCase()!==account.toLowerCase()||status!==2) err('Only this active originator can repay an unsettled deal','DEAL_NOT_REPAYABLE',403);
  const remaining=quote.repayment-paid,vaultAddress=quote.vault;
  if(remaining<=0n) err('Deal already repaid','DEAL_NOT_REPAYABLE',409);
  return tx('Repay financed exit',[{address:m.asset,abi:tokenAbi,functionName:'approve',args:[vaultAddress,String(remaining)]},{address:m.settlement,abi:settlementAbi,functionName:'repay',args:[digest,String(remaining)]}],formatUnits(remaining,6));
 }
 if(actionId==='manager.set-mandate'&&vault) {
  const target=inputs.originatorAddress;if(!isAddress(target)||!m.originators.some(o=>o.address.toLowerCase()===target.toLowerCase())) err('Select an invited originator wallet','UNKNOWN_ORIGINATOR');
  const pct=Number(inputs.exposurePercent),mask=Number(inputs.routeMask);
  if(!Number.isInteger(pct)||pct<0||pct>100||![1,2,3].includes(mask)) err('Risk cap must be 0 to 100% of NAV','BAD_MANDATE');
  const limit=parseAmount(inputs.dealLimit),nav=BigInt(await publicClient.readContract({address:vault.address,abi:vaultAbi,functionName:'totalAssets'}) as bigint),cap=nav*BigInt(pct)/100n;
  if(limit<0n||limit>cap) err('Per-deal limit exceeds NAV-based exposure cap','BAD_MANDATE');
  return tx('Set originator risk mandate',[
   {address:vault.address,abi:vaultAbi,functionName:'setMandate',args:[target,String(cap),String(limit),mask]},
   {address:vault.address,abi:vaultAbi,functionName:'setExposureCap',args:[target,pct*100]}
  ],formatUnits(cap,6));
 }
 if(actionId==='manager.process-queue'&&vault) {
  const max=Number(inputs.maxRequests);if(!Number.isInteger(max)||max<1||max>50) err('Choose 1 to 50 requests','BAD_QUEUE_LIMIT');
  return tx('Process withdrawal queue',[{address:vault.address,abi:vaultAbi,functionName:'processQueue',args:[max]}]);
 }
 err('Wallet is not authorized for this organization action','WORKSPACE_FORBIDDEN',403);
}
