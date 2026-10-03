import { isAddressEqual, type Address } from 'viem';
import { vaultAbi } from './abi';
import { DEPLOYMENT } from './config';
import { parseAmount, checkedUint } from './amounts';
import type { PreparedAction } from './actions';
import type { Action, Snapshot } from './model';
export type PartnerOperation=Extract<Action,{kind:'vaultPostReserve'|'vaultRepay'|'vaultMarkLate'}>;
export function buildPartnerOperation(action:PartnerOperation,snapshot:Snapshot):PreparedAction {
 const v=snapshot.vaults.find(vault=>isAddressEqual(vault.address,action.vault));
 if(!v || ![DEPLOYMENT.vaultA,DEPLOYMENT.vaultB].some(address=>isAddressEqual(address,v.address))) throw new Error('Select a deployed partner vault from the current snapshot.');
 const call:PreparedAction={address:v.address,abi:vaultAbi,functionName:'',args:[]};
 if(action.kind==='vaultPostReserve') {
  const platform=action.platform as Address;
  if(!v.approvedPlatforms.some(address=>isAddressEqual(address,platform))) throw new Error('The partner vault must approve this platform before a reserve is posted.');
  const assets=parseAmount(action.amount);
  return {...call,functionName:'postReserve',args:[platform,assets],approval:{spender:v.address,amount:assets}};
 }
 const id=checkedUint(action.advanceId);
 const advance=v.advances?.find(a=>a.id===id);
 if(!advance || advance.owed===0n) throw new Error('Select an outstanding partner advance.');
 if(action.kind==='vaultRepay') {
  if(advance.status!==1 && advance.status!==3) throw new Error('Only active or late partner advances can be repaid.');
  return {...call,functionName:'repay',args:[id],approval:{spender:v.address,amount:advance.owed}};
 }
 if(advance.status!==1) throw new Error('Only active partner advances can be marked late.');
 if(advance.grace===undefined) throw new Error('Refresh the partner advance grace period before marking it late.');
 if(advance.dueAt+advance.grace>BigInt(Math.floor(snapshot.observedAt/1000))) throw new Error('The partner repayment grace period has not ended at the latest observed block. Refresh chain data.');
 return {...call,functionName:'markLate',args:[id]};
}
