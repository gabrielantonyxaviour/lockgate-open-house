import { decodeFunctionData, parseEventLogs, type Abi, type Address } from 'viem';
import { artifact, publicClient } from './shared.js';
import { chainLogs } from './chain-logs.js';
const abi=artifact('DemoFirmVault').abi as Abi;
/** Replays real unit-changing events; cash-only claim payments do not burn book units twice. */
export async function providerLedger(vault:Address,account:Address,currentUnits:bigint,currentNav:bigint,totalUnits:bigint) {
 const logs=await chainLogs(vault);
 const events=parseEventLogs({abi,logs,strict:false});
 let units=0n,basis=0n,realizedIncome=0n,realizedLoss=0n;
 const remove=(removed:bigint,assets:bigint)=>{
  if(removed<=0n||removed>units)throw new Error('Provider ledger unit reconciliation failed');
  const allocated=removed===units?basis:basis*removed/units;
  basis-=allocated;units-=removed;
  if(assets>allocated)realizedIncome+=assets-allocated;else realizedLoss+=allocated-assets;
 };
 for(const event of events) {
  const args=event.args as Record<string,unknown>;
  if(event.eventName==='Deposited'&&String(args.provider).toLowerCase()===account.toLowerCase()){
   units+=BigInt(args.units as bigint);basis+=BigInt(args.assets as bigint);
  }
  if(event.eventName==='WithdrawalFilled'){
   const withdrawal=await publicClient.readContract({address:vault,abi,functionName:'withdrawals',args:[args.id]}) as readonly [Address,bigint];
   if(withdrawal[0].toLowerCase()===account.toLowerCase())remove(BigInt(args.units as bigint),BigInt(args.assets as bigint));
  }
  if(event.eventName==='Claimed'&&String(args.provider).toLowerCase()===account.toLowerCase()){
   const tx=await publicClient.getTransaction({hash:event.transactionHash!});
   const call=decodeFunctionData({abi,data:tx.input});
   if(call.functionName==='withdraw'&&tx.from.toLowerCase()===account.toLowerCase())remove(BigInt(call.args?.[0] as bigint),BigInt(args.assets as bigint));
  }
 }
 if(units!==currentUnits)throw new Error('Provider ledger does not match current on-chain ownership');
 const nav=totalUnits?currentUnits*currentNav/totalUnits:0n;
 return {principal:basis,nav,income:realizedIncome+(nav>basis?nav-basis:0n),loss:realizedLoss+(basis>nav?basis-nav:0n)};
}
