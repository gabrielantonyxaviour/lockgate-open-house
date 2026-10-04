import type { Address } from 'viem';
import { manifest, type Manifest } from './shared.js';

export type InstitutionRole = 'originator' | 'manager';
export type InstitutionScope = {
 role: InstitutionRole; actor: Address; representative: Address; organization: string;
 signerIndex: number; delegated: boolean;
};

// TEST filming representatives. They operate existing organizations through a
// separately signed, narrowly scoped service relay; neither address is a vault manager.
const representativeAssignments = [
 {address:'0xdf4cf26bd1be352505b2d76de2f4f19c0a020b06',role:'originator',index:0,name:'Alder Credit Platform'},
 {address:'0xbd01f07b5a7be85b2fd961c7fd3f99d1db7edfbd',role:'manager',index:1,name:'Meridian Investment Firm'},
] as const;

export function institutionScope(account:Address,m:Manifest=manifest()):InstitutionScope|undefined {
 const assignment=representativeAssignments.find(item=>item.address.toLowerCase()===account.toLowerCase());
 if(assignment){
  const target=assignment.role==='originator'?m.originators[assignment.index]:m.vaults[assignment.index];
  const actualName=assignment.role==='originator'?m.originators[assignment.index]?.name:m.vaults[assignment.index]?.firm;
  if(!target||actualName!==assignment.name)throw new Error('Institution fixture does not match this deployment');
  return {role:assignment.role,actor:assignment.role==='originator'?(target as Manifest['originators'][number]).address:(target as Manifest['vaults'][number]).manager,
   representative:account,organization:actualName,signerIndex:assignment.role==='originator'?assignment.index+1:assignment.index+6,delegated:true};
 }
 const originatorIndex=m.originators.findIndex(item=>item.address.toLowerCase()===account.toLowerCase());
 if(originatorIndex>=0)return {role:'originator',actor:account,representative:account,organization:m.originators[originatorIndex].name,signerIndex:originatorIndex+1,delegated:false};
 const managerIndex=m.vaults.findIndex(item=>item.manager.toLowerCase()===account.toLowerCase());
 if(managerIndex>=0)return {role:'manager',actor:account,representative:account,organization:m.vaults[managerIndex].firm,signerIndex:managerIndex+6,delegated:false};
 return undefined;
}
