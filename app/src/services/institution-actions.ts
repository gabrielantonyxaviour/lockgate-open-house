import { isAddressEqual, type Address, type Hex } from 'viem';
import { z } from 'zod';
import type { authorizedWallet } from '../chain/wallet';
import type { InstitutionProgress, Receipt, Workspace } from '../demo/types';
import { receiptSchema, type DemoTransport } from './demo-transport';

const address=z.string().regex(/^0x[\da-f]{40}$/i);
const hash=z.string().regex(/^0x[\da-f]{64}$/i);
const fields=[{name:'representative',type:'address'},{name:'institution',type:'address'},{name:'role',type:'string'},{name:'actionId',type:'string'},{name:'parameters',type:'string'},{name:'actionHash',type:'bytes32'},{name:'planId',type:'bytes32'},{name:'deadline',type:'uint64'}] as const;
const planSchema=z.object({
 id:hash,title:z.string().min(1),amount:z.string().optional(),actionId:z.string().min(1),inputs:z.record(z.string(),z.string()),
 representative:address,executionAccount:address,organization:z.string().min(1),role:z.enum(['originator','manager']),expiresAt:z.string().datetime(),authorized:z.boolean(),
 typedData:z.object({domain:z.object({name:z.literal('LockgateInstitutionAuthorization'),version:z.literal('1'),chainId:z.literal(421614),verifyingContract:address}),primaryType:z.literal('InstitutionAction'),types:z.object({InstitutionAction:z.array(z.object({name:z.string(),type:z.string()}))}),message:z.object({representative:address,institution:address,role:z.enum(['originator','manager']),actionId:z.string(),parameters:z.string(),actionHash:hash,planId:hash,deadline:z.coerce.bigint().positive()})}),
 steps:z.array(z.object({index:z.number().int().nonnegative(),label:z.string().min(1),status:z.enum(['ready','submitted','confirmed','reverted']),hash:hash.optional(),receipt:receiptSchema.optional()})).min(1).max(3),receipt:receiptSchema.optional(),
});
type Stored={id:string;actionId:string;inputs:Record<string,string>};
const equalInputs=(a:Record<string,string>,b:Record<string,string>)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
const key=(account:Address)=>`lockgate.institution.pending.v1:${account.toLowerCase()}`;
function stored(account:Address):Stored|undefined {
 try{return z.object({id:hash,actionId:z.string(),inputs:z.record(z.string(),z.string())}).parse(JSON.parse(localStorage.getItem(key(account))||'null'));}catch{return undefined;}
}
function persist(account:Address,plan?:Stored){try{if(plan)localStorage.setItem(key(account),JSON.stringify({id:plan.id,actionId:plan.actionId,inputs:plan.inputs}));else localStorage.removeItem(key(account));}catch{/* Server-side plans remain recoverable. */}}
function validate(value:unknown,account:Address,scope:NonNullable<Workspace['authorization']>,registry:Address,actionId:string,inputs:Record<string,string>) {
 const plan=planSchema.parse(value),data=plan.typedData,message=data.message;
 const addressesMatch=isAddressEqual(plan.representative as Address,account)&&isAddressEqual(scope.representativeWallet,account)&&isAddressEqual(plan.executionAccount as Address,scope.executionWallet)&&isAddressEqual(message.representative as Address,account)&&isAddressEqual(message.institution as Address,scope.executionWallet)&&isAddressEqual(data.domain.verifyingContract as Address,registry);
 const fieldsMatch=data.types.InstitutionAction.length===fields.length&&fields.every((field,index)=>data.types.InstitutionAction[index].name===field.name&&data.types.InstitutionAction[index].type===field.type);
 const planMatches=plan.actionId===actionId&&message.actionId===actionId&&message.parameters===JSON.stringify(plan.inputs)&&plan.role===scope.role&&message.role===scope.role&&message.planId===plan.id&&equalInputs(plan.inputs,inputs)&&Number(message.deadline)===Math.floor(Date.parse(plan.expiresAt)/1000);
 if(!addressesMatch||!fieldsMatch||!planMatches||plan.steps.some((step,index)=>step.index!==index||(step.status!=='ready'&&!step.hash)))throw new Error('The institutional authorization does not match the reviewed wallet, action and institution.');
 return plan;
}
export async function institutionAction({api,account,workspace,registry,actionId,inputs,wallet,onProgress}:{
 api:DemoTransport;account:Address;workspace:Workspace;registry:Address;actionId:string;inputs:Record<string,string>;
 wallet:()=>Promise<Awaited<ReturnType<typeof authorizedWallet>>>;onProgress?:(progress:InstitutionProgress)=>void;
}):Promise<Receipt> {
 const scope=workspace.authorization;if(!scope)throw new Error('An approved institutional representative is required.');
 let current:InstitutionProgress={phase:'preparing',label:'Preparing your exact authorization',executionAccount:scope.executionWallet};
 const progress=(event:InstitutionProgress)=>{current={...event,executionAccount:scope.executionWallet};onProgress?.(current);};
 progress(current);
 const parse=(value:unknown)=>validate(value,account,scope,registry,actionId,inputs);
 const status=(id:string)=>api.request(`workspace-action/status?id=${encodeURIComponent(id)}`).then(parse);
 try {
  const local=stored(account),server=workspace.pendingActions?.find(item=>item.actionId===actionId&&equalInputs(item.inputs,inputs));
  const prior=local?.actionId===actionId&&equalInputs(local.inputs,inputs)?local:server;
  let plan=prior?await status(prior.id):parse(await api.request('workspace-action/prepare',{actionId,inputs}));
  if(!plan.authorized&&Date.parse(plan.expiresAt)<=Date.now()) {
   persist(account);plan=parse(await api.request('workspace-action/prepare',{actionId,inputs}));
  }
  persist(account,plan);
  let signature:Hex|undefined;
  if(!plan.authorized) {
   if(Date.parse(plan.expiresAt)<=Date.now())throw new Error('This authorization expired. Review the action again.');
   progress({phase:'authorization-requested',label:'Authorize this action in your wallet',totalSteps:plan.steps.length});
   signature=await (await wallet()).signTypedData({domain:{...plan.typedData.domain,verifyingContract:registry},types:{InstitutionAction:fields},primaryType:'InstitutionAction',message:{...plan.typedData.message,representative:account,institution:scope.executionWallet,planId:plan.id as Hex,actionHash:plan.typedData.message.actionHash as Hex}});
  }
  progress({phase:'authorized',label:plan.authorized?'Resuming your authorized action':'Wallet authorization received',totalSteps:plan.steps.length});
  let finalReceipt=plan.receipt;
  for(let index=0;index<plan.steps.length;index++) {
   let step=plan.steps[index];
   if(step.status!=='confirmed') {
    progress({phase:'submitted',stepIndex:index,totalSteps:plan.steps.length,label:`${step.hash?'Confirming':'Submitting'}: ${step.label}`,hash:step.hash as Hex|undefined});
    try {plan=parse(await api.request('workspace-action/execute',{id:plan.id,...(signature?{signature}:{}),step:index}));}
    catch(error) {
     try{plan=await status(plan.id);}catch{throw error;}
     if(plan.steps[index].status!=='confirmed')throw error;
    }
    signature=undefined;step=plan.steps[index];
   }
   if(step.status!=='confirmed'||!step.hash)throw new Error('The institution transaction is still awaiting confirmation. Retry this action to resume its existing transaction.');
   progress({phase:'confirmed',stepIndex:index,totalSteps:plan.steps.length,label:step.label,hash:step.hash as Hex});
   finalReceipt=step.receipt||plan.receipt||finalReceipt;
  }
  if(!finalReceipt||finalReceipt.status!=='confirmed'||!isAddressEqual(finalReceipt.account as Address,account)||finalReceipt.hash!==plan.steps.at(-1)?.hash)throw new Error('The confirmed institution receipt has not been reconciled. Retry to retrieve its proof.');
  persist(account);return finalReceipt as Receipt;
 }catch(error){progress({...current,phase:'error',message:error instanceof Error?error.message:'The action could not be confirmed. Retry the same action to recover its status.'});throw error;}
}
