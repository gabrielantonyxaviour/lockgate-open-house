import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import type { Manifest } from '../src/demo/shared.js';
import type { InstitutionPlan } from '../src/demo/store.js';
import { institutionScope } from '../src/demo/institution-representatives.js';
import { assertInstitutionStep, institutionTypedData, needsInstitutionSimulation, verifyInstitutionAuthorization } from '../src/demo/workspace-authorizations.js';

const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as Address;
const hash=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as Hex;
const manifest={chainId:421614,rpcUrl:'http://127.0.0.1:8545',asset:address(11),registry:address(12),settlement:address(13),
 originators:['Alder Credit Platform','Birch Receivables','Cedar Income Trust','Dune Asset Network','Elm Yield Platform'].map((name,i)=>({name,address:address(i+1)})),
 vaults:['Northstar Investment Firm','Meridian Investment Firm','Anchor Capital Firm','Bluewater Investment Firm','Pioneer Securities Firm'].map((firm,i)=>({id:`firm-${i+1}`,name:`${firm} vehicle`,firm,address:address(i+30),manager:address(i+20),termsHash:hash(i+1),termsText:'TEST terms'})),holdings:[]} satisfies Manifest;

test('Only two exact representative wallets inherit scoped institution views, never actor identity',()=>{
 const originator=institutionScope('0xdf4cf26bd1be352505b2d76de2f4f19c0a020b06',manifest);
 assert.deepEqual([originator?.role,originator?.actor,originator?.signerIndex,originator?.delegated],['originator',address(1),1,true]);
 const manager=institutionScope('0xbd01f07b5a7be85b2fd961c7fd3f99d1db7edfbd',manifest);
 assert.deepEqual([manager?.role,manager?.actor,manager?.signerIndex,manager?.delegated],['manager',address(21),7,true]);
 assert.equal(institutionScope(address(99),manifest),undefined);
 assert.equal(institutionScope(address(1),manifest)?.delegated,false);
 assert.throws(()=>institutionScope('0xdf4cf26bd1be352505b2d76de2f4f19c0a020b06',{...manifest,originators:[{...manifest.originators[0],name:'Different'},...manifest.originators.slice(1)]}));
});

test('Institution authorization binds representative, actor, action, plan, chain, and expiry',async()=>{
 const signer=privateKeyToAccount(generatePrivateKey()),now=Date.now();
 const plan:InstitutionPlan={id:hash(400),account:signer.address,actor:address(1),role:'originator',organization:'Alder Credit Platform',signerIndex:1,
  actionId:'originator.register-holding',actionHash:hash(500),title:'Register TEST holding',createdAt:new Date(now).toISOString(),
  expiresAt:new Date(now+300000).toISOString(),inputs:{units:'100'},steps:[]};
 const signature=await signer.signTypedData(institutionTypedData(plan,manifest.registry));
 assert.equal(await verifyInstitutionAuthorization(plan,signature,now,manifest.registry),true);
 assert.equal(await verifyInstitutionAuthorization(plan,signature,now+300000,manifest.registry),false);
 for(const changed of [
  {...plan,id:hash(401)}, {...plan,actor:address(2)}, {...plan,actionHash:hash(501)},
  {...plan,actionId:'originator.repay'}, {...plan,role:'manager' as const},
  {...plan,account:address(7)}, {...plan,inputs:{units:'101'}},
  {...plan,expiresAt:new Date(now+240000).toISOString()}
 ])assert.equal(await verifyInstitutionAuthorization(changed,signature,now,manifest.registry),false);
 assert.equal(await verifyInstitutionAuthorization(plan,signature,now,address(99)),false);
});

test('Each chain step is ordered, confirmed retries are inert, and partial actions have a bounded recovery window',()=>{
 const now=Date.now(),step=(index:number,status:'ready'|'confirmed'|'reverted'='ready')=>({index,label:index?'Repay obligation':'Approve TEST USDG',address:address(12),functionName:index?'repay':'approve',args:[],status});
 const plan:InstitutionPlan={id:hash(600),account:address(90),actor:address(1),role:'originator',organization:'Alder Credit Platform',signerIndex:1,
  actionId:'originator.repay',actionHash:hash(601),title:'Repay financed exit',createdAt:new Date(now).toISOString(),
  expiresAt:new Date(now+300000).toISOString(),inputs:{digest:hash(602)},steps:[step(0),step(1)]};
 assert.equal(assertInstitutionStep(plan,0,now),'ready');
 assert.throws(()=>assertInstitutionStep(plan,1,now),{code:'STEP_ORDER_REQUIRED'});
 assert.throws(()=>assertInstitutionStep(plan,0,now+300000),{code:'ACTION_EXPIRED'});
 plan.authorizedAt=new Date(now+1000).toISOString();plan.executionExpiresAt=new Date(now+1801000).toISOString();
 plan.steps[0].status='confirmed';
 assert.equal(assertInstitutionStep(plan,0,now+900000),'confirmed');
 assert.equal(assertInstitutionStep(plan,1,now+900000),'ready');
 assert.throws(()=>assertInstitutionStep(plan,1,now+1801000),{code:'ACTION_EXPIRED'});
 plan.steps[1].status='reverted';
 assert.throws(()=>assertInstitutionStep(plan,1,now+2000),{code:'CHAIN_REVERT'});
});

test('Lost HTTP response resumes the exact journaled raw transaction without simulating changed post-mining state',()=>{
 const pending={hash:hash(700),status:'pending' as const};
 assert.equal(needsInstitutionSimulation(undefined),true);
 assert.equal(needsInstitutionSimulation(pending),false);
 assert.equal(needsInstitutionSimulation({...pending,status:'confirmed'}),false);
 const now=Date.now(),plan:InstitutionPlan={id:hash(701),account:address(90),actor:address(1),role:'originator',organization:'Alder Credit Platform',signerIndex:1,
  actionId:'originator.register-holding',actionHash:hash(702),title:'Register TEST holding',createdAt:new Date(now-2000000).toISOString(),
  expiresAt:new Date(now-1700000).toISOString(),authorizedAt:new Date(now-1900000).toISOString(),
  executionExpiresAt:new Date(now-100000).toISOString(),inputs:{units:'500'},
  steps:[{index:0,label:'Register holding',address:address(12),functionName:'registerHolding',args:[],status:'submitted',hash:pending.hash}]};
 assert.equal(assertInstitutionStep(plan,0,now),'ready','a previously signed raw transaction remains resumable even after the plan window');
 plan.steps[0].status='ready';
 assert.throws(()=>assertInstitutionStep(plan,0,now),{code:'ACTION_EXPIRED'},'a fresh transaction may not start after expiry');
});
