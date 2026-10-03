import {describe,expect,it} from 'vitest';
import type {Address} from 'viem';
import {buildAction} from '../src/chain/actions';
import {DEPLOYMENT} from '../src/chain/config';
import {previewSnapshot} from '../src/ui/preview';
import type {Action,PartnerAdvance} from '../src/chain/model';
const payer:Address='0x3333333333333333333333333333333333333333';
function snapshot() {
 const s=previewSnapshot();s.mode='live';s.account=payer;s.usdgBalance=100_000_000n;
 const v=s.vaults[0];v.address=DEPLOYMENT.vaultA;v.approvedPlatforms=[DEPLOYMENT.platform];
 v.advances=[{id:1n,platform:DEPLOYMENT.platform,recipient:DEPLOYMENT.platform,navValue:10_000_000n,fee:100_000n,principal:9_900_000n,
 principalRemaining:9_900_000n,feeRemaining:100_000n,owed:10_000_000n,fundedAt:1n,dueAt:1n,requestId:1n,exitRef:`0x${'11'.repeat(32)}`,status:1,grace:60n} as PartnerAdvance];
 return s;
}
describe('partner reserve and repayment transactions',()=>{
 it('allows any payer to post an exact reserve for an approved platform',()=>{
  const s=snapshot();expect(s.vaults[0].owner).not.toBe(payer);
  expect(buildAction({kind:'vaultPostReserve',vault:DEPLOYMENT.vaultA,platform:DEPLOYMENT.platform,amount:'0.75'},s,payer)).toMatchObject({address:DEPLOYMENT.vaultA,functionName:'postReserve',args:[DEPLOYMENT.platform,750_000n],approval:{spender:DEPLOYMENT.vaultA,amount:750_000n}});
 });
 it('rejects reserves for unapproved platforms and amounts beyond wallet funds',()=>{
  const s=snapshot();const action:Action={kind:'vaultPostReserve',vault:DEPLOYMENT.vaultA,platform:DEPLOYMENT.platform,amount:'1'};
  s.vaults[0].approvedPlatforms=[];expect(()=>buildAction(action,s,payer)).toThrow('approve');
  s.vaults[0].approvedPlatforms=[DEPLOYMENT.platform];s.usdgBalance=1n;expect(()=>buildAction(action,s,payer)).toThrow('USDG balance');
 });
 it.each([1,3])('pays the exact outstanding principal plus fee for status %i',status=>{
  const s=snapshot();s.vaults[0].advances![0].status=status;s.vaults[0].advances![0].owed=8_250_000n;
  expect(buildAction({kind:'vaultRepay',vault:DEPLOYMENT.vaultA,advanceId:1n},s,payer)).toMatchObject({functionName:'repay',args:[1n],approval:{spender:DEPLOYMENT.vaultA,amount:8_250_000n}});
 });
 it('rejects already repaid, unknown and invalid advance IDs',()=>{
  const s=snapshot();s.vaults[0].advances![0].status=2;
  expect(()=>buildAction({kind:'vaultRepay',vault:DEPLOYMENT.vaultA,advanceId:1n},s,payer)).toThrow('active or late');
  expect(()=>buildAction({kind:'vaultRepay',vault:DEPLOYMENT.vaultA,advanceId:2n},s,payer)).toThrow('outstanding');
  expect(()=>buildAction({kind:'vaultRepay',vault:DEPLOYMENT.vaultA,advanceId:0n},s,payer)).toThrow();
 });
 it('uses the funding-time grace and permits public late marking without token approval',()=>{
  const s=snapshot();const action:Action={kind:'vaultMarkLate',vault:DEPLOYMENT.vaultA,advanceId:1n};
  expect(buildAction(action,s,payer)).toMatchObject({functionName:'markLate',args:[1n]});
  expect(buildAction(action,s,payer).approval).toBeUndefined();
  s.vaults[0].advances![0].grace=undefined;expect(()=>buildAction(action,s,payer)).toThrow('Refresh');
  s.vaults[0].advances![0].grace=BigInt(Math.floor(Date.now()/1000));expect(()=>buildAction(action,s,payer)).toThrow('grace');
  s.vaults[0].advances![0].status=3;expect(()=>buildAction(action,s,payer)).toThrow('active');
 });
 it('uses the observed chain timestamp when browser and fork clocks differ',()=>{
  const s=snapshot();const a=s.vaults[0].advances![0];a.dueAt=BigInt(Math.floor(Date.now()/1000))+600n;a.grace=60n;
  s.observedAt=Number(a.dueAt+60n)*1000;
  expect(buildAction({kind:'vaultMarkLate',vault:DEPLOYMENT.vaultA,advanceId:1n},s,payer).functionName).toBe('markLate');
  s.observedAt-=1000;expect(()=>buildAction({kind:'vaultMarkLate',vault:DEPLOYMENT.vaultA,advanceId:1n},s,payer)).toThrow('observed block');
 });
});
