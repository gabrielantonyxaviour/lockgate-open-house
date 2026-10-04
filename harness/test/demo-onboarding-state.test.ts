import assert from 'node:assert/strict';
import {test} from 'node:test';
import {demoState,publicStats} from '../src/demo/state.js';
import {publicClient} from '../src/demo/shared.js';
import {profile} from '../src/demo/store.js';

const account='0x1111111111111111111111111111111111111111' as const;

test('Unverified retail onboarding reads real wallet balances without loading vault history',async()=>{
 const originalRead=publicClient.readContract,originalBalance=publicClient.getBalance,originalLogs=publicClient.getLogs;
 const p=profile(account);const priorRole=p.role,priorIdentity=p.identityId;
 let historyReads=0,balanceReads=0;
 publicClient.readContract=(async({functionName}: {functionName:string})=>{
  if(functionName==='matches')return false;
  assert.equal(functionName,'balanceOf','Unverified onboarding must not read financial books');
  return 1234567n;
 }) as typeof originalRead;
 publicClient.getBalance=(async()=>{balanceReads++;return 500000000000000n;}) as typeof originalBalance;
 publicClient.getLogs=(async()=>{historyReads++;throw new Error('Unverified onboarding scanned history');}) as typeof originalLogs;
 try{
  for(const role of ['investor','provider'] as const){
   for(const identityId of [undefined,'alex-morgan']){
    p.role=role;p.identityId=identityId;
    const state=await demoState(account);
    assert.equal(state.profile.activeRole,role);
    assert.equal(state.profile.identity,undefined);
    assert.equal(state.setup.gas,'0.0005');
    assert.equal(state.setup.usdg,'1.234567');
    assert.equal(state.setup.canMint,false);assert.equal(state.setup.canFund,false);
    assert.equal(state.positionStatus,'unavailable');
    assert.deepEqual(state.positions,[]);assert.deepEqual(state.vehicles,[]);
    assert.equal(state.workspace,undefined);
   }
  }
  assert.equal(balanceReads,4);assert.equal(historyReads,0);
 }finally{
  p.role=priorRole;p.identityId=priorIdentity;
  publicClient.readContract=originalRead;publicClient.getBalance=originalBalance;publicClient.getLogs=originalLogs;
 }
});

test('Public metrics aggregate the existing contract reads accurately',async()=>{
 const originalRead=publicClient.readContract,originalBlock=publicClient.getBlock;
 publicClient.readContract=(async({functionName}:{functionName:string})=>{
  if(functionName==='isActive'||functionName==='approvedVault')return true;
  if(functionName==='holding')return {routeMask:3};
  if(functionName==='availableCash')return 1000000n;
  if(functionName==='outstandingPrincipal')return 2000000n;
  throw new Error(`Unexpected public read: ${functionName}`);
 }) as typeof originalRead;
 publicClient.getBlock=(async()=>({number:123n,timestamp:100n})) as typeof originalBlock;
 try{const stats=await publicStats();assert.equal(stats.originators,5);assert.equal(stats.firms,5);assert.equal(stats.availableCash,'5');assert.equal(stats.outstanding,'10');assert.equal(stats.blockNumber,'123');assert.equal(stats.platforms.length,5);}
 finally{publicClient.readContract=originalRead;publicClient.getBlock=originalBlock;}
});
