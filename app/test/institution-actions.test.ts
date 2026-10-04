import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { institutionAction } from '../src/services/institution-actions';
import { DemoTransport } from '../src/services/demo-transport';
import type { InstitutionProgress, Workspace } from '../src/demo/types';
const representative='0xdf4cf26bd1be352505b2d76de2f4f19c0a020b06' as Address;
const execution='0x82130f97959Bb7410c6Fff67c3df43ca8499179D' as Address;
const registry='0xaad84eaf1c6d5927cb9fb60e7dfefd479141b9cd' as Address;
const h=(n:string)=>`0x${n.repeat(64)}` as Hex;
const inputs={profileId:'lucas-chen',units:'100000',routeMask:'2',divisible:'true'};
const actionId='originator.register-holding';
const workspace:Workspace={title:'Originator account',organization:'Alder Credit Platform',status:'Active',checks:[],records:[],authorization:{representativeWallet:representative,executionWallet:execution,role:'originator'}};
const types=[{name:'representative',type:'address'},{name:'institution',type:'address'},{name:'role',type:'string'},{name:'actionId',type:'string'},{name:'parameters',type:'string'},{name:'actionHash',type:'bytes32'},{name:'planId',type:'bytes32'},{name:'deadline',type:'uint64'}];
const receipt=(index:number)=>({id:h(String(index+1)),title:index===0?'USDG approved':'Repayment confirmed',status:'confirmed',hash:h(String(index+1)),createdAt:new Date().toISOString(),account:representative});
function plan(authorized=false,confirmed=0,count=1){
 const deadline=Math.floor(Date.now()/1000)+300;
 return {id:h('a'),title:'Register holding',actionId,inputs,representative,executionAccount:execution,organization:'Alder Credit Platform',role:'originator',expiresAt:new Date(deadline*1000).toISOString(),authorized,typedData:{domain:{name:'LockgateInstitutionAuthorization',version:'1',chainId:421614,verifyingContract:registry},types:{InstitutionAction:types},primaryType:'InstitutionAction',message:{representative,institution:execution,role:'originator',actionId,parameters:JSON.stringify(inputs),actionHash:h('b'),planId:h('a'),deadline:String(deadline)}},steps:Array.from({length:count},(_,index)=>({index,label:index===0?'Approve USDG':'Repay obligation',status:index<confirmed?'confirmed':'ready',...(index<confirmed?{hash:h(String(index+1)),receipt:receipt(index)}:{})}))};
}
const sign=vi.fn().mockResolvedValue(h('c'));
const wallet=async()=>({signTypedData:sign}) as unknown as Awaited<ReturnType<typeof import('../src/chain/wallet').authorizedWallet>>;
const run=(onProgress?:(p:InstitutionProgress)=>void)=>institutionAction({api:new DemoTransport(),account:representative,workspace,registry,actionId,inputs,wallet,onProgress});
beforeEach(()=>{
 const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)});sign.mockClear();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('signs one exact authorization and returns a real confirmed server receipt',async()=>{
 const request=vi.spyOn(DemoTransport.prototype,'request').mockImplementation(async path=>path==='workspace-action/prepare'?plan():plan(true,1));
 const events:InstitutionProgress[]=[];
 await expect(run(e=>events.push(e))).resolves.toMatchObject({hash:h('1'),account:representative,status:'confirmed'});
 expect(sign).toHaveBeenCalledTimes(1);
 expect(sign.mock.calls[0][0].message).toMatchObject({representative,institution:execution,actionId,deadline:expect.any(BigInt)});
 expect(request.mock.calls[1]).toEqual(['workspace-action/execute',{id:h('a'),signature:h('c'),step:0}]);
 expect(events.map(e=>e.phase)).toEqual(['preparing','authorization-requested','authorized','submitted','confirmed']);
});

it.each(['wallet','institution','registry','role','inputs','planId','deadline','steps'])('rejects mismatched %s before requesting a wallet signature',async change=>{
 const p=plan();
 if(change==='wallet')p.representative=execution;
 if(change==='institution')p.typedData.message.institution=representative;
 if(change==='registry')p.typedData.domain.verifyingContract=execution;
 if(change==='role')p.role='manager';
 if(change==='inputs')p.inputs={...inputs,units:'200000'};
 if(change==='planId')p.typedData.message.planId=h('d');
 if(change==='deadline')p.typedData.message.deadline='1';
 if(change==='steps')p.steps[0].index=1;
 vi.spyOn(DemoTransport.prototype,'request').mockResolvedValue(p);
 await expect(run()).rejects.toThrow('does not match');expect(sign).not.toHaveBeenCalled();
});

it('resumes the same plan after approval without repeating approval or signing again',async()=>{
 let confirmed=0;let fail=true;
 const request=vi.spyOn(DemoTransport.prototype,'request').mockImplementation(async(path,body)=>{
  if(path==='workspace-action/prepare')return plan(false,0,2);
  if(path.startsWith('workspace-action/status'))return plan(true,confirmed,2);
  const step=(body as {step:number}).step;
  if(step===1&&fail){fail=false;throw new Error('Response lost');}
  confirmed=step+1;return plan(true,confirmed,2);
 });
 await expect(run()).rejects.toThrow('Response lost');expect(confirmed).toBe(1);
 await expect(run()).resolves.toMatchObject({hash:h('2'),status:'confirmed'});
 expect(sign).toHaveBeenCalledTimes(1);
 expect(request.mock.calls.filter(([path,body])=>path==='workspace-action/execute'&&(body as {step:number}).step===0)).toHaveLength(1);
 expect(request.mock.calls.filter(([path])=>path==='workspace-action/prepare')).toHaveLength(1);
});

it('recovers a lost final response from the persisted confirmed step',async()=>{
 vi.spyOn(DemoTransport.prototype,'request').mockImplementation(async path=>{
  if(path==='workspace-action/prepare')return plan();
  if(path.startsWith('workspace-action/status'))return plan(true,1);
  throw new Error('Response lost');
 });
 await expect(run()).resolves.toMatchObject({hash:h('1'),status:'confirmed'});
});

it('never calls an approval or pending hash a completed repayment',async()=>{
 const p=plan(true,0);p.steps[0]={...p.steps[0],status:'submitted',hash:h('1')};
 vi.spyOn(DemoTransport.prototype,'request').mockImplementation(async path=>path==='workspace-action/prepare'?plan():p);
 await expect(run()).rejects.toThrow('still awaiting confirmation');
});
