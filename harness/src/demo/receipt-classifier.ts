import { decodeFunctionData, formatUnits, parseEventLogs, type Abi, type Transaction, type TransactionReceipt } from 'viem';
import { artifact, publicClient, type Manifest } from './shared.js';
/** A client label is never evidence of a payment; derive receipt descriptions from executed calldata/events. */
export async function classifyReceipt(tx:Transaction,receipt:TransactionReceipt,m:Manifest):Promise<{title:string;amount?:string;residual?:string;detail?:string}> {
 const target=tx.to?.toLowerCase();
 const kind=target===m.asset.toLowerCase()?'MockUSDG':target===m.registry.toLowerCase()?'DemoRegistry':target===m.settlement.toLowerCase()?'DemoSettlement':'DemoFirmVault';
 const abi=artifact(kind).abi as Abi;
 let call;try{call=decodeFunctionData({abi,data:tx.input});}catch{return {title:'Contract transaction',detail:'No supported financial event was identified.'};}
 const events=parseEventLogs({abi,logs:receipt.logs.filter(log=>log.address.toLowerCase()===target),strict:false});
 const event=(name:string)=>events.find(item=>item.eventName===name)?.args as Record<string,unknown>|undefined;
 const amount=(value:unknown)=>formatUnits(BigInt(value as bigint),6);
 if(receipt.status!=='success')return {title:`${call.functionName} reverted`,detail:'No successful settlement was recorded.'};
 if(kind==='MockUSDG'&&call.functionName==='approve')return {title:'USDG spending approved',amount:amount(call.args?.[1]),detail:`Spender: ${String(call.args?.[0])}`};
 if(kind==='DemoRegistry'){
  if(event('IdentityBound'))return {title:'Identity linked',detail:'Wallet-bound TEST identity attestation confirmed.'};
  const holding=event('HoldingRegistered');if(holding)return {title:'TEST holding registered',amount:amount(holding.units),detail:`Claim: ${String(holding.id)}`};
  if(event('OrganizationActivated'))return {title:'Organization terms accepted'};
 }
 if(kind==='DemoSettlement'){
  const settled=event('Settled');
  if(settled){
   const deal=await publicClient.readContract({address:m.settlement,abi,functionName:'deal',args:[settled.digest],blockNumber:receipt.blockNumber}) as {quote:{holdingId:`0x${string}`}};
   const holding=await publicClient.readContract({address:m.registry,abi:artifact('DemoRegistry').abi as Abi,functionName:'holding',args:[deal.quote.holdingId],blockNumber:receipt.blockNumber}) as {remaining:bigint};
   return {title:String(settled.investor).toLowerCase()===tx.from.toLowerCase()?'Early payout received':'Exit settled',amount:amount(settled.payout),residual:amount(holding.remaining),detail:`Deal: ${String(settled.digest)}; recipient: ${String(settled.investor)}; route: ${String(settled.route)}`};
  }
  const repaid=event('Repaid');if(repaid)return {title:'Claim collection / repayment confirmed',amount:amount(repaid.amount),detail:`Deal: ${String(repaid.digest)}; remaining due: ${amount(repaid.remaining)} USDG`};
  if(event('Cancelled'))return {title:'Unused exit reservation released'};
  if(event('Reserved'))return {title:'Exit cash reserved',amount:amount(event('Reserved')!.payout)};
 }
 if(kind==='DemoFirmVault'){
  const deposited=event('Deposited');if(deposited)return {title:'Vehicle funded',amount:amount(deposited.assets),detail:`Provider: ${String(deposited.provider)}; issued book units: ${amount(deposited.units)}`};
  const claimed=event('Claimed');if(claimed)return {title:'Withdrawal received',amount:amount(claimed.assets),detail:`Provider: ${String(claimed.provider)}`};
  const queued=event('WithdrawalRequested');
  if(queued){const [nav,total]=await Promise.all(['totalAssets','totalUnits'].map(functionName=>publicClient.readContract({address:tx.to!,abi,functionName,blockNumber:receipt.blockNumber}) as Promise<bigint>));return {title:'Withdrawal requested',amount:amount(total?BigInt(queued.units as bigint)*nav/total:0n),detail:`Request: ${String(queued.id)}; current NAV estimate, subject to settlement valuation.`};}
  if(call.functionName==='cancelWithdrawal')return {title:'Unfilled withdrawal cancelled',detail:`Request: ${String(call.args?.[0])}`};
  if(call.functionName==='processQueue')return {title:'Withdrawal queue processed',detail:'Only confirmed filled requests allocate claimable cash.'};
  if(call.functionName==='setMandate')return {title:'Originator risk mandate updated',detail:`Originator: ${String(call.args?.[0])}`};
  if(call.functionName==='setExposureCap')return {title:'NAV exposure cap updated',detail:`Originator: ${String(call.args?.[0])}; basis points: ${String(call.args?.[1])}`};
  if(event('SubscriptionAccepted'))return {title:'Subscription accepted by firm'};
 }
 return {title:'Contract transaction confirmed',detail:`Confirmed method: ${call.functionName}`};
}
