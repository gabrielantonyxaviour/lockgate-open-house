import type { Address } from 'viem';
export type Tranche = 0 | 1;
export interface FacilityAccounting {
 cash:bigint; drawn:bigint; seniorDrawn:bigint; seniorPrincipal:bigint; juniorPrincipal:bigint;
 seniorDeficit:bigint; juniorDeficit:bigint; seniorInterestDue:bigint; juniorInterestDue:bigint;
 seniorInterestCash:bigint; juniorInterestCash:bigint; residual:bigint; locked:bigint;
 seniorAprBps:bigint; juniorAprBps:bigint; advanceRateBps:number; maxLateBps:number; minJuniorBps:number;
 lastAccrual:bigint; recovery:boolean;
}
export interface Facility {
 address:Address; governor:Address; borrower:Address; asset:Address; receivables:Address;
 accounting:FacilityAccounting; borrowingBase:bigint; availableDraw:bigint; solvent:boolean;
 approvedLender:boolean; lenderCount:bigint; seniorShares:bigint; juniorShares:bigint;
 seniorSupply:bigint; juniorSupply:bigint; seniorClaimable:bigint; juniorClaimable:bigint;
 seniorIdle:bigint; juniorIdle:bigint;
}
export type FacilityAction =
 | {kind:'facilityApproveLender';lender:Address;approved:boolean}
 | {kind:'facilityDeposit';tranche:Tranche;amount:string}
 | {kind:'facilityRedeem';tranche:Tranche;amount:string}
 | {kind:'facilityWithdrawInterest';tranche:Tranche}
 | {kind:'facilityDraw';amount:string}
 | {kind:'facilityRepay';amount:string}
 | {kind:'facilityPoke'}
 | {kind:'facilityRecognizeLoss'};
