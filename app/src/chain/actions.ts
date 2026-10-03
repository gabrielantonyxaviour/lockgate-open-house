import { isAddressEqual, type Abi, type Address, type Hash } from 'viem';
import { z } from 'zod';
import { creditLineAbi, platformAbi, tokenAbi, vaultAbi } from './abi';
import { DEPLOYMENT, CHAIN } from './config';
import { checkedAddress, errorMessage, publicClient, quoteExit, quoteRequest } from './client';
import { assertFreshQuote, checkedUint, parseAmount } from './amounts';
import { authorizedWallet } from './wallet';
import { actionSchema } from './action-schema';
import type { Action, OnTransactionState, Snapshot } from './model';
export interface PreparedAction { address:Address; abi:Abi; functionName:string; args:readonly unknown[]; approval?:{spender:Address; amount:bigint} }
const same = (a:Address,b:Address)=>isAddressEqual(a,b);
export function buildAction(action:Action,snapshot:Snapshot,account:Address):PreparedAction {
 actionSchema.parse(action);
 checkedAddress(account);
 if(snapshot.mode!=='live') throw new Error('Preview mode cannot submit transactions.');
 if(!snapshot.account || !same(snapshot.account,account)) throw new Error('Refresh the connected wallet snapshot before signing.');
 const args:unknown[]=[];
 let address:Address=DEPLOYMENT.creditLine;
 let abi:Abi=creditLineAbi;
 let functionName:string=action.kind;
 let approval:PreparedAction['approval'];
 const requireOperator = ()=>{if(!same(snapshot.creditLine.owner,account)) throw new Error('Only the Lockgate owner can perform this action.');};
 const amount = ()=>'amount' in action ? parseAmount(action.amount) : 0n;
 if(action.kind==='registerSource') {requireOperator();args.push(checkedAddress(action.platform),amount(),action.reserveBps);}
 else if('platform' in action && !('vault' in action)) {
  checkedAddress(action.platform);
  const platform=snapshot.platforms.find(p=>same(p.address,action.platform));
  if(!platform) throw new Error('Select a registered platform from the current snapshot.');
  address=platform.address; abi=platformAbi;
  if(action.kind==='setSourceTerms') {requireOperator();address=DEPLOYMENT.creditLine;abi=creditLineAbi;args.push(platform.address,amount(),action.reserveBps,action.riskBps);}
  else if(action.kind==='setAllowlist') {if(!same(platform.issuer,account)) throw new Error('Only this platform issuer can change eligibility.');args.push(checkedAddress(action.account),action.allowed);}
  else if(action.kind==='postReserve') {address=DEPLOYMENT.creditLine; abi=creditLineAbi; args.push(platform.address,amount()); approval={spender:address,amount:amount()};}
  else if(action.kind==='setNav' || action.kind==='setGated') {
   if(!same(platform.issuer,account)) throw new Error('Only this platform issuer can change its controls.');
   args.push(action.kind==='setNav' ? amount() : z.boolean().parse(action.gated));
  } else if(action.kind==='deposit' || action.kind==='depositCash') {
   if(action.kind==='deposit' && platform.blocked) throw new Error('This wallet is blocked by the issuer.');
   args.push(amount()); approval={spender:address,amount:amount()};
  } else if(action.kind==='requestRedeem' || action.kind==='exitNow') {
   const shares=parseAmount(action.amount,18);
   if(shares>platform.holding) throw new Error('Amount exceeds the connected wallet’s share balance.');
   if(platform.gated) throw new Error('This platform is gated.');
   args.push(shares);
   if(action.kind==='exitNow') {assertFreshQuote(action.quotedAt);args.push(checkedUint(action.minUsdgOut));}
  } else if(action.kind==='exitEarly' || action.kind==='cancel') {
   const request=platform.requests.find(r=>r.id===action.requestId);
   if(!request || !same(request.owner,account) || request.status!=='Queued') throw new Error('Only the owner of a queued request can perform this action.');
   args.push(checkedUint(action.requestId));
   if(action.kind==='exitEarly') {assertFreshQuote(action.quotedAt);args.push(checkedUint(action.minUsdgOut));}
  } else if(action.kind==='processWindow') {
   if(platform.nextWindow>BigInt(Math.floor(Date.now()/1000))) throw new Error('The settlement window is not open yet.');
  }
 } else if('vault' in action) {
  checkedAddress(action.vault);
  const vault=snapshot.vaults.find(v=>same(v.address,action.vault));
  if(!vault || !same(vault.owner,account)) throw new Error('Only the partner owner can move vault capital.');
  address=vault.address; abi=vaultAbi;
  if(action.kind==='vaultSetPaused') {functionName='setPaused';args.push(action.paused);}
  else if(action.kind==='vaultSetPlatform') {functionName='setPlatform';args.push(checkedAddress(action.platform),action.approved,amount(),action.reserveBps,action.checkGate,action.maxNavAge);}
  else if(action.kind==='vaultSetMandate') {functionName='setMandate';args.push(action.minFeeBps,action.maxTenor,action.concentrationBps,action.expiry);}
  else {
  const assets=amount();
  if(action.kind==='vaultDeposit') {functionName='deposit';args.push(assets);approval={spender:address,amount:assets};}
  else {if(assets>vault.idle) throw new Error('Withdrawal exceeds idle partner cash.');functionName='withdraw';args.push(assets,account);}
  }
 } else if(action.kind==='markLate') {
  const advance=snapshot.creditLine.advances.find(a=>a.id===action.advanceId);
  if(!advance || advance.status!=='Active') throw new Error('Select an active advance.');
  if(advance.dueAt+advance.grace>BigInt(Math.floor(Date.now()/1000))) throw new Error('The repayment grace period has not ended.');
  args.push(checkedUint(action.advanceId));
 } else {
  requireOperator();
  if(action.kind==='setCaps') args.push(action.maxUtilizationBps,action.maxConcentrationBps);
  else if(action.kind==='setGrace') args.push(action.seconds);
  else if(action.kind==='depositCapital' || action.kind==='withdrawCapital') {
   args.push(amount());
   if(action.kind==='depositCapital') approval={spender:address,amount:amount()};
  }
 }
 if(approval && approval.amount>snapshot.usdgBalance) throw new Error('Amount exceeds your USDG balance.');
 return {address,abi,functionName,args,approval};
}
export async function sendAction(action:Action,snapshot:Snapshot,onState:OnTransactionState=()=>{}):Promise<Hash> {
 const account=snapshot.account;
 if(!account) throw new Error('Connect a wallet first.');
 let lastHash:Hash|undefined;
 let awaitingReceipt=false;
 try {
  onState({phase:'checking',message:'Checking permissions and current contract state.'});
  const prepared=buildAction(action,snapshot,account);
  if(await publicClient.getChainId()!==CHAIN.id) throw new Error('The RPC is not Arbitrum Sepolia.');
  if(action.kind==='exitNow' || action.kind==='exitEarly') {
   const fresh=action.kind==='exitNow' ? await quoteExit(action.platform,parseAmount(action.amount,18)) : await quoteRequest(action.platform,action.requestId);
   if(!fresh.available) throw new Error(fresh.reason || 'This exit is not available.');
   if(fresh.usdgOut<action.minUsdgOut) throw new Error('The quote changed below your minimum received. Review a new quote.');
  }
  if(prepared.approval) {
   const allowance=await publicClient.readContract({address:DEPLOYMENT.usdg,abi:tokenAbi,functionName:'allowance',args:[account,prepared.approval.spender]});
   if(allowance<prepared.approval.amount) {
    onState({phase:'approval',message:'Approve the exact USDG amount in your wallet. This is a separate transaction.'});
    const approval=await publicClient.simulateContract({account,address:DEPLOYMENT.usdg,abi:tokenAbi,functionName:'approve',args:[prepared.approval.spender,prepared.approval.amount]});
    const wallet=await authorizedWallet(account);
    const hash=await wallet.writeContract(approval.request);
    lastHash=hash; awaitingReceipt=true;
    onState({phase:'pending',hash,message:'Waiting for USDG approval.'});
    const receipt=await publicClient.waitForTransactionReceipt({hash});
    awaitingReceipt=false;
    if(receipt.status!=='success') throw new Error('The USDG approval reverted.');
   }
  }
  if(action.kind==='exitNow' || action.kind==='exitEarly') assertFreshQuote(action.quotedAt);
  const simulation=await publicClient.simulateContract({account,address:prepared.address,abi:prepared.abi,functionName:prepared.functionName,args:prepared.args});
  if(action.kind==='exitNow' || action.kind==='exitEarly') assertFreshQuote(action.quotedAt);
  onState({phase:'confirming',message:'Review and confirm the transaction in your wallet.'});
  const wallet=await authorizedWallet(account);
  if(action.kind==='exitNow' || action.kind==='exitEarly') assertFreshQuote(action.quotedAt);
  const hash=await wallet.writeContract(simulation.request);
  lastHash=hash; awaitingReceipt=true;
  onState({phase:'pending',hash,message:'Transaction submitted. Waiting for confirmation.'});
  const receipt=await publicClient.waitForTransactionReceipt({hash});
  awaitingReceipt=false;
  if(receipt.status!=='success') throw new Error('The contract transaction reverted.');
  onState({phase:'success',hash,message:'Transaction confirmed on Arbitrum Sepolia.'});
  return hash;
 } catch(error) {
  onState({phase:'error',hash:lastHash,confirmationUnknown:awaitingReceipt,message:awaitingReceipt ? 'Transaction submitted; confirmation is unverified. Check the transaction in the explorer before retrying.' : errorMessage(error)});
  throw error;
 }
}
