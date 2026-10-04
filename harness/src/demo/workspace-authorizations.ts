import { randomBytes } from 'node:crypto';
import { keccak256, toHex, verifyTypedData, type Abi, type Address, type Hex } from 'viem';
import { artifact, chain, err, manifest, publicClient } from './shared.js';
import { institutionScope } from './institution-representatives.js';
import { profile, save, type InstitutionPlan, type ReceiptRecord } from './store.js';
import { workspaceAction } from './workspace.js';
import { contractTransaction, contractTransactionRecord } from './transactions.js';

const authorizationTypes={InstitutionAction:[
 {name:'representative',type:'address'},{name:'institution',type:'address'},
 {name:'role',type:'string'},{name:'actionId',type:'string'},{name:'parameters',type:'string'},
 {name:'actionHash',type:'bytes32'},{name:'planId',type:'bytes32'},
 {name:'deadline',type:'uint64'}
]} as const;
const actionRoles:Record<string,'originator'|'manager'>={
 'originator.register-holding':'originator','originator.repay':'originator',
 'manager.set-mandate':'manager','manager.process-queue':'manager'
};
const stepNames:Record<string,string>={
 registerHolding:'Register holding',approve:'Approve TEST USDG',repay:'Repay obligation',
 setMandate:'Set mandate',setExposureCap:'Set exposure cap',processQueue:'Process withdrawal queue'
};
const actionExpiry=5*60_000,finishExpiry=30*60_000;
const namespace=(plan:InstitutionPlan,index:number)=>`institution:${plan.id}:${index}`;
export const needsInstitutionSimulation=(existing?:{hash:Hex;status:'pending'|'confirmed'|'reverted'})=>!existing;
const abiFor=(address:Address)=>{
 const m=manifest();
 if(address.toLowerCase()===m.asset.toLowerCase())return artifact('MockUSDG').abi as Abi;
 if(address.toLowerCase()===m.registry.toLowerCase())return artifact('DemoRegistry').abi as Abi;
 if(address.toLowerCase()===m.settlement.toLowerCase())return artifact('DemoSettlement').abi as Abi;
 if(m.vaults.some(v=>v.address.toLowerCase()===address.toLowerCase()))return artifact('DemoFirmVault').abi as Abi;
 err('Institution action target is not in this deployment','WORKSPACE_FORBIDDEN',403);
};
export const institutionTypedData=(plan:InstitutionPlan,registry:Address=manifest().registry)=>({
 domain:{name:'LockgateInstitutionAuthorization',version:'1',chainId:chain.id,verifyingContract:registry},
 types:authorizationTypes,primaryType:'InstitutionAction' as const,
 message:{representative:plan.account,institution:plan.actor,role:plan.role,actionId:plan.actionId,
  parameters:JSON.stringify(plan.inputs),actionHash:plan.actionHash,planId:plan.id,
  deadline:BigInt(Math.floor(Date.parse(plan.expiresAt)/1000))}
});

function ownPlan(account:Address,id:Hex):InstitutionPlan {
 const plan=profile(account).institutionPlans?.find(item=>item.id===id);
 if(!plan||plan.account.toLowerCase()!==account.toLowerCase())err('This institution action is unavailable','ACTION_NOT_FOUND',404);
 const scope=institutionScope(account);
 if(!scope?.delegated||scope.actor.toLowerCase()!==plan.actor.toLowerCase()||scope.role!==plan.role)
  err('Institution authorization has changed','WORKSPACE_FORBIDDEN',403);
 return plan;
}
function planView(plan:InstitutionPlan){return {
 id:plan.id,title:plan.title,amount:plan.amount,actionId:plan.actionId,inputs:plan.inputs,
 representative:plan.account,executionAccount:plan.actor,organization:plan.organization,role:plan.role,
 expiresAt:plan.expiresAt,executionExpiresAt:plan.executionExpiresAt,authorized:Boolean(plan.authorizedAt),
  typedData:{...institutionTypedData(plan),message:{...institutionTypedData(plan).message,deadline:Number(institutionTypedData(plan).message.deadline)}},
  steps:plan.steps.map(step=>({index:step.index,label:step.label,status:step.status,hash:step.hash,
   receipt:step.hash?profile(plan.account).receipts.find(item=>item.hash?.toLowerCase()===step.hash?.toLowerCase()):undefined}))
};}

function recordConfirmed(plan:InstitutionPlan,stepIndex:number){
 const p=profile(plan.account),step=plan.steps[stepIndex];
 if(!step.hash)return;
 if(!p.receipts.some(item=>item.hash?.toLowerCase()===step.hash?.toLowerCase())){
  const receipt:ReceiptRecord={id:step.hash,title:step.label,status:'confirmed',hash:step.hash,
   amount:stepIndex===plan.steps.length-1?plan.amount:undefined,createdAt:new Date().toISOString(),account:plan.account,
   executionAccount:plan.actor,representativeAccount:plan.account,
   detail:`Authorized by ${plan.account}; submitted on-chain by ${plan.actor} for ${plan.organization}.`};
  p.receipts.unshift(receipt);
 }
 if(plan.actionId==='originator.register-holding'&&plan.holding&&!p.minted.some(item=>item.id===plan.holding?.id)){
  const m=manifest();p.minted.push({id:plan.holding.id,identityId:plan.holding.profileId,
   name:'Alder Private Credit',originator:plan.organization,originatorAddress:plan.actor,units:plan.holding.units});
 }
 return p.receipts.find(item=>item.hash?.toLowerCase()===step.hash?.toLowerCase());
}
function reconcile(plan:InstitutionPlan){
 let changed=false;
 for(const step of plan.steps){
  if(step.status==='confirmed')continue;
  const item=contractTransactionRecord(plan.signerIndex,step.address,abiFor(step.address),step.functionName,step.args,namespace(plan,step.index));
  if(!item)continue;
  const next=item.status==='pending'?'submitted':item.status;
  if(step.hash!==item.hash||step.status!==next){step.hash=item.hash;step.status=next;changed=true;}
  if(step.status==='confirmed')recordConfirmed(plan,step.index);
 }
 if(changed)save();
}
function ensureScope(account:Address,role:'originator'|'manager'){
 const scope=institutionScope(account),p=profile(account);
 if(!scope?.delegated||scope.role!==role||p.role!==role||!p.roles?.includes(role))
  err('This wallet is not an authorized institution representative','WORKSPACE_FORBIDDEN',403);
 return scope;
}
export async function verifyInstitutionAuthorization(plan:InstitutionPlan,signature:Hex,now=Date.now(),registry:Address=manifest().registry){
 if(now>=Date.parse(plan.expiresAt))return false;
 return verifyTypedData({address:plan.account,...institutionTypedData(plan,registry),signature});
}
export function assertInstitutionStep(plan:InstitutionPlan,index:number,now=Date.now()){
 const step=plan.steps[index];if(!step)err('Action step is unavailable','STEP_NOT_FOUND',404);
 if(step.status==='confirmed')return 'confirmed' as const;
 if(step.status==='reverted')err('The institution transaction reverted','CHAIN_REVERT',409);
 if(plan.steps.slice(0,index).some(item=>item.status!=='confirmed'))err('Complete the previous transaction first','STEP_ORDER_REQUIRED',409);
 if(!plan.authorizedAt&&now>=Date.parse(plan.expiresAt))err('Authorization expired; review this action again','ACTION_EXPIRED',409);
 if(plan.authorizedAt&&step.status!=='submitted'&&now>=Date.parse(plan.executionExpiresAt??plan.expiresAt))
  err('Authorized action expired; review its current chain state','ACTION_EXPIRED',409);
 return 'ready' as const;
}
async function activeActor(plan:Pick<InstitutionPlan,'actor'|'role'>){
 const m=manifest(),abi=artifact('DemoRegistry').abi as Abi;
 const active=await publicClient.readContract({address:m.registry,abi,functionName:'isActive',args:[plan.actor,plan.role==='originator'?1:2]});
 if(!active)err('The institution is no longer active','INSTITUTION_INACTIVE',403);
 if(plan.role==='manager'){
  const v=m.vaults.find(item=>item.manager.toLowerCase()===plan.actor.toLowerCase());
  if(!v||!await publicClient.readContract({address:m.registry,abi,functionName:'approvedVault',args:[v.address]}))
   err('The institution vehicle is not approved','INSTITUTION_INACTIVE',403);
 }
}

export async function prepareInstitutionAction(account:Address,actionId:string,inputs:Record<string,string>){
 const role=actionRoles[actionId];if(!role)err('Action is unavailable','WORKSPACE_FORBIDDEN',403);
 const scope=ensureScope(account,role),p=profile(account);
 for(const existing of p.institutionPlans??[]){
  reconcile(existing);
  if(existing.authorizedAt&&existing.steps.some(step=>step.status!=='confirmed')&&
   (existing.steps.some(step=>step.status==='submitted')||Date.parse(existing.executionExpiresAt??'')>Date.now()))
   err('Finish the previously authorized institution action first','ACTION_IN_PROGRESS',409);
 }
 const reusable=(p.institutionPlans??[]).slice().reverse().find(item=>!item.authorizedAt&&item.actionId===actionId&&
  JSON.stringify(item.inputs)===JSON.stringify(inputs)&&Date.parse(item.expiresAt)>Date.now());
 if(reusable)return planView(reusable);
 const draft={actor:scope.actor,role,account,organization:scope.organization,signerIndex:scope.signerIndex};
 await activeActor(draft);
 const intent=await workspaceAction(account,actionId,inputs);
 const id=`0x${randomBytes(32).toString('hex')}` as Hex,now=Date.now();
 const steps=intent.transactions.map((tx,index)=>({index,label:stepNames[tx.functionName]??tx.functionName,
  address:tx.address,functionName:tx.functionName,args:tx.args,status:'ready' as const}));
 const actionHash=keccak256(toHex(JSON.stringify({actionId,inputs,actor:scope.actor,role,steps:steps.map(({address,functionName,args})=>({address,functionName,args}))})));
 const holding='holding' in intent?intent.holding:undefined;
 const plan:InstitutionPlan={id,account,actor:scope.actor,role,organization:scope.organization,signerIndex:scope.signerIndex,
  actionId,actionHash,title:intent.title,amount:intent.amount,createdAt:new Date(now).toISOString(),
  expiresAt:new Date((Math.floor(now/1000)+actionExpiry/1000)*1000).toISOString(),inputs:{...inputs},steps,holding};
 p.institutionPlans??=[];p.institutionPlans.push(plan);save();return planView(plan);
}
export function institutionActionStatus(account:Address,id:Hex){const plan=ownPlan(account,id);reconcile(plan);return planView(plan);}
export function pendingInstitutionActions(account:Address){
 const scope=institutionScope(account);if(!scope?.delegated)return [];
 return (profile(account).institutionPlans??[]).filter(plan=>{
  reconcile(plan);return plan.steps.some(step=>step.status!=='confirmed')&&
   (plan.steps.some(step=>step.status==='submitted')||Date.parse(plan.executionExpiresAt??plan.expiresAt)>Date.now());
 }).map(planView);
}
export async function executeInstitutionStep(account:Address,id:Hex,index:number,signature?:Hex){
 const plan=ownPlan(account,id),step=plan.steps[index];
 if(!step)err('Action step is unavailable','STEP_NOT_FOUND',404);
 ensureScope(account,plan.role);reconcile(plan);
 const disposition=assertInstitutionStep(plan,index);
 if(disposition==='confirmed'){const receipt=recordConfirmed(plan,index);save();return {...planView(plan),hash:step.hash,status:'confirmed' as const,receipt};}
 if(!plan.authorizedAt){
  if(!signature||!await verifyInstitutionAuthorization(plan,signature))
   err('Wallet authorization does not match this action','BAD_SIGNATURE',403);
 }
 await activeActor(plan);
 const abi=abiFor(step.address);
 const existing=contractTransactionRecord(plan.signerIndex,step.address,abi,step.functionName,step.args,namespace(plan,index));
 if(needsInstitutionSimulation(existing)){
  try{await publicClient.simulateContract({account:plan.actor,address:step.address,abi,functionName:step.functionName,args:step.args});}
  catch{
   if(plan.authorizedAt)plan.executionExpiresAt=new Date().toISOString();
   else plan.expiresAt=new Date().toISOString();
   save();err('Current chain state no longer permits this exact action','ACTION_STALE',409);
  }
 }
 if(!plan.authorizedAt){
  if(Date.now()>=Date.parse(plan.expiresAt))err('Authorization expired; review this action again','ACTION_EXPIRED',409);
  plan.signature=signature;plan.authorizedAt=new Date().toISOString();
  plan.executionExpiresAt=new Date(Date.now()+finishExpiry).toISOString();save();
 }
 const hash=await contractTransaction(plan.signerIndex,step.address,abi,step.functionName,step.args,namespace(plan,index));
 step.hash=hash;step.status='confirmed';const receipt=recordConfirmed(plan,index);save();
 return {...planView(plan),hash,status:'confirmed' as const,receipt};
}
