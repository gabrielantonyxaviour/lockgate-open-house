import { isAddressEqual, zeroAddress, type Address } from 'viem';
import { z } from 'zod';
import { DEPLOYMENT } from './config';
import { facilityAbi } from './facility-abi';
import { parseAmount } from './amounts';
import type { FacilityAction } from './facility-model';
import type { PreparedAction } from './actions';
import type { Snapshot } from './model';
const tranche=z.union([z.literal(0),z.literal(1)]);
const amount=z.string().min(1).max(100);
export const facilityActionSchemas=[
 z.object({kind:z.literal('facilityApproveLender'),lender:z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v=>v!==zeroAddress,'Lender must be nonzero.'),approved:z.boolean()}),
 z.object({kind:z.literal('facilityDeposit'),tranche,amount}),
 z.object({kind:z.literal('facilityRedeem'),tranche,amount}),
 z.object({kind:z.literal('facilityWithdrawInterest'),tranche}),
 z.object({kind:z.literal('facilityDraw'),amount}),z.object({kind:z.literal('facilityRepay'),amount}),
 z.object({kind:z.literal('facilityPoke')}),z.object({kind:z.literal('facilityRecognizeLoss')}),
] as const;
export function buildFacilityAction(action:FacilityAction,snapshot:Snapshot,account:Address):PreparedAction {
 const f=snapshot.facility;
 if(!f || !isAddressEqual(f.address,DEPLOYMENT.facility) || !isAddressEqual(f.asset,DEPLOYMENT.usdg)) throw new Error('Refresh the deployed facility before signing.');
 const call:PreparedAction={address:f.address,abi:facilityAbi,functionName:'',args:[]};
 if(action.kind==='facilityApproveLender') {
  if(!isAddressEqual(account,f.governor)) throw new Error('Only the facility governor can approve lenders.');
  return {...call,functionName:'approveLender',args:[action.lender,action.approved]};
 }
 if(action.kind==='facilityPoke') return {...call,functionName:'poke'};
 if(action.kind==='facilityRecognizeLoss') {
  if(!f.accounting.recovery) throw new Error('The facility must be in recovery before recognizing a loss.');
  return {...call,functionName:'recognizeLoss'};
 }
 if(action.kind==='facilityWithdrawInterest') {
  if((action.tranche===0?f.seniorClaimable:f.juniorClaimable)===0n) throw new Error('No paid interest is claimable for this tranche.');
  return {...call,functionName:'withdrawInterest',args:[action.tranche]};
 }
 const assets=parseAmount(action.amount);
 if(action.kind==='facilityDraw') {
  if(!isAddressEqual(account,f.borrower)) throw new Error('Only the facility borrower can draw capital.');
  if(f.accounting.recovery || assets>f.availableDraw) throw new Error('Draw exceeds current facility borrowing capacity.');
  return {...call,functionName:'draw',args:[assets]};
 }
 if(action.kind==='facilityRepay') return {...call,functionName:'repay',args:[assets],approval:{spender:f.address,amount:assets}};
 if(action.kind==='facilityDeposit') {
  if(!f.approvedLender) throw new Error('The facility governor must approve this lender before depositing.');
  if(action.tranche===1 && f.accounting.recovery) throw new Error('Junior deposits are disabled during recovery.');
  return {...call,functionName:'deposit',args:[action.tranche,assets],approval:{spender:f.address,amount:assets}};
 }
 const senior=action.tranche===0;
 if(assets>(senior?f.seniorShares:f.juniorShares)) throw new Error('Redemption exceeds your tranche share balance.');
 if(!senior && f.accounting.recovery && (f.accounting.seniorDrawn>0n || f.accounting.seniorInterestDue>0n)) throw new Error('Senior obligations must clear before junior redemption.');
 const supply=senior?f.seniorSupply:f.juniorSupply;
 const principal=senior?f.accounting.seniorPrincipal:f.accounting.juniorPrincipal;
 const value=supply===0n?0n:assets*principal/supply;
 if(value===0n || value>(senior?f.seniorIdle:f.juniorIdle)) throw new Error('These shares exceed the tranche’s redeemable idle principal.');
 return {...call,functionName:'redeem',args:[action.tranche,assets]};
}
