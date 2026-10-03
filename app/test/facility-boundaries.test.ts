import {describe,expect,it,vi} from 'vitest';
import {encodeFunctionData,type Address} from 'viem';
import {buildAction} from '../src/chain/actions';
import {facilityAbi} from '../src/chain/facility-abi';
import {DEPLOYMENT} from '../src/chain/config';
import {readFacility} from '../src/chain/facility-read';
import {previewSnapshot} from '../src/ui/preview';
import type {Action,Facility,Snapshot} from '../src/chain/model';
const governor:Address='0x1111111111111111111111111111111111111111';
const borrower:Address='0x2222222222222222222222222222222222222222';
const lender:Address='0x3333333333333333333333333333333333333333';
function snapshot(account:Address=lender):Snapshot {
 const s=previewSnapshot();s.mode='live';s.account=account;s.usdgBalance=100_000_000n;
 s.facility={address:DEPLOYMENT.facility,governor,borrower,asset:DEPLOYMENT.usdg,receivables:DEPLOYMENT.creditLine,
 accounting:{cash:100_000_000n,drawn:0n,seniorDrawn:0n,seniorPrincipal:80_000_000n,juniorPrincipal:20_000_000n,
 seniorDeficit:0n,juniorDeficit:0n,seniorInterestDue:0n,juniorInterestDue:0n,seniorInterestCash:0n,juniorInterestCash:0n,
 residual:0n,locked:0n,seniorAprBps:800n,juniorAprBps:1200n,advanceRateBps:8000,maxLateBps:1000,minJuniorBps:2000,lastAccrual:1n,recovery:false},
 borrowingBase:50_000_000n,availableDraw:50_000_000n,solvent:true,approvedLender:true,lenderCount:1n,
 seniorShares:80_000_000n,juniorShares:20_000_000n,seniorSupply:80_000_000n,juniorSupply:20_000_000n,
 seniorClaimable:1_000n,juniorClaimable:500n,seniorIdle:80_000_000n,juniorIdle:20_000_000n};
 return s;
}
const call=(action:Action,s=snapshot())=>buildAction(action,s,s.account!);
describe('institutional facility authority and money boundaries',()=>{
 it('requires a connected live matching account and actual deployment',()=>{
  const a:Action={kind:'facilityDeposit',tranche:0,amount:'1'};const s=snapshot();
  s.mode='preview';expect(()=>call(a,s)).toThrow('Preview');s.mode='live';
  expect(()=>buildAction(a,s,governor)).toThrow('Refresh');s.facility=undefined;expect(()=>call(a,s)).toThrow('facility');
 });
 it('allows lender approval only for the governor, not the borrower or line owner',()=>{
  const a:Action={kind:'facilityApproveLender',lender,approved:true};
  expect(()=>call(a,snapshot(borrower))).toThrow('governor');
  expect(call(a,snapshot(governor))).toMatchObject({address:DEPLOYMENT.facility,functionName:'approveLender',args:[lender,true]});
 });
 it('rejects zero lender and invalid tranche or money before preparing a call',()=>{
  for(const a of [{kind:'facilityApproveLender',lender:'0x0000000000000000000000000000000000000000',approved:true},{kind:'facilityDeposit',tranche:2,amount:'1'},{kind:'facilityDeposit',tranche:0,amount:'0.0000001'}]) expect(()=>call(a as Action)).toThrow();
 });
 it.each([0,1] as const)('deposits tranche %i with exact six-decimal approval only',tranche=>{
  const prepared=call({kind:'facilityDeposit',tranche,amount:'1.25'});
  expect(prepared).toMatchObject({address:DEPLOYMENT.facility,functionName:'deposit',args:[tranche,1_250_000n],approval:{spender:DEPLOYMENT.facility,amount:1_250_000n}});
  expect(encodeFunctionData({abi:facilityAbi,functionName:'deposit',args:[tranche,1_250_000n]})).toMatch(/^0x/);
 });
 it('requires approved lender and enough tokens; recovery blocks only junior deposits',()=>{
  const s=snapshot();s.facility!.approvedLender=false;
  expect(()=>call({kind:'facilityDeposit',tranche:0,amount:'1'},s)).toThrow('approve');
  s.facility!.approvedLender=true;s.usdgBalance=0n;
  expect(()=>call({kind:'facilityDeposit',tranche:0,amount:'1'},s)).toThrow('USDG balance');
  s.usdgBalance=100_000_000n;s.facility!.accounting.recovery=true;
  expect(()=>call({kind:'facilityDeposit',tranche:1,amount:'1'},s)).toThrow('recovery');
  expect(()=>call({kind:'facilityDeposit',tranche:0,amount:'1'},s)).not.toThrow();
 });
 it('keeps facility share units at six decimals and permits exits by revoked lenders',()=>{
  const s=snapshot();s.facility!.approvedLender=false;
  expect(call({kind:'facilityRedeem',tranche:0,amount:'1.25'},s)).toMatchObject({functionName:'redeem',args:[0,1_250_000n]});
  expect(call({kind:'facilityRedeem',tranche:0,amount:'1'},s).approval).toBeUndefined();
 });
 it('limits redeemed shares by ownership and underlying idle principal',()=>{
  const s=snapshot();expect(()=>call({kind:'facilityRedeem',tranche:1,amount:'21'},s)).toThrow('share balance');
  s.facility!.seniorIdle=0n;expect(()=>call({kind:'facilityRedeem',tranche:0,amount:'1'},s)).toThrow('idle principal');
  s.facility!.accounting.recovery=true;s.facility!.accounting.seniorInterestDue=1n;
  expect(()=>call({kind:'facilityRedeem',tranche:1,amount:'1'},s)).toThrow('Senior obligations');
 });
 it('draws only for borrower inside borrowing capacity',()=>{
  const a:Action={kind:'facilityDraw',amount:'1'};expect(()=>call(a,snapshot(governor))).toThrow('borrower');
  expect(call(a,snapshot(borrower))).toMatchObject({functionName:'draw',args:[1_000_000n]});
  expect(()=>call({kind:'facilityDraw',amount:'51'},snapshot(borrower))).toThrow('capacity');
  const s=snapshot(borrower);s.facility!.accounting.recovery=true;expect(()=>call(a,s)).toThrow('capacity');
 });
 it('allows repayment by any wallet with exact requested approval',()=>expect(call({kind:'facilityRepay',amount:'0.25'})).toMatchObject({functionName:'repay',args:[250_000n],approval:{spender:DEPLOYMENT.facility,amount:250_000n}}));
 it('distinguishes paid claimable interest from unpaid accrued interest',()=>{
  const s=snapshot();s.facility!.seniorClaimable=0n;s.facility!.accounting.seniorInterestDue=100_000n;
  expect(()=>call({kind:'facilityWithdrawInterest',tranche:0},s)).toThrow('No paid interest');
  expect(call({kind:'facilityWithdrawInterest',tranche:1},s)).toMatchObject({functionName:'withdrawInterest',args:[1]});
 });
 it('allows public covenant checks and only recognizes losses after recovery',()=>{
  expect(call({kind:'facilityPoke'})).toMatchObject({functionName:'poke',args:[]});
  const s=snapshot();expect(()=>call({kind:'facilityRecognizeLoss'},s)).toThrow('recovery');
  s.facility!.accounting.recovery=true;expect(call({kind:'facilityRecognizeLoss'},s)).toMatchObject({functionName:'recognizeLoss',args:[]});
 });
});
describe('facility read consistency',()=>{
 function reader(patch:Record<string,unknown>={}) {
  const f=snapshot().facility as Facility;
  const data:Record<string,unknown>={...f,seniorClaim:5n,juniorClaim:7n,seniorIndex:2n*10n**27n,juniorIndex:10n**27n,seniorIndexOf:10n**27n,juniorIndexOf:0n,...patch};
  return vi.fn(async (_address,_abi,name)=>data[name]) as ReturnType<typeof vi.fn> & Parameters<typeof readFacility>[2];
 }
 it('reads every field at one block and includes paid index credits in claimable cash',async()=>{
  const read=reader();const f=await readFacility(lender,123n,read);
  expect(f.seniorClaimable).toBe(80_000_005n);expect(f.juniorClaimable).toBe(20_000_007n);
  expect(read.mock.calls.every(c=>c[4]===123n)).toBe(true);expect(f.seniorIdle).toBe(80_000_000n);
 });
 it('leaves disconnected balances empty without inferring lender eligibility',async()=>{
  const read=reader();const f=await readFacility(undefined,123n,read);
  expect(f.approvedLender).toBe(false);expect(f.seniorShares).toBe(0n);expect(f.juniorClaimable).toBe(0n);
  expect(read.mock.calls.some(c=>c[2]==='approvedLender')).toBe(false);
 });
 it('refuses a mismatched facility token and impossible interest index',async()=>{
  await expect(readFacility(lender,123n,reader({asset:governor}))).rejects.toThrow('asset');
  await expect(readFacility(lender,123n,reader({seniorIndexOf:3n*10n**27n}))).rejects.toThrow('index');
 });
});
