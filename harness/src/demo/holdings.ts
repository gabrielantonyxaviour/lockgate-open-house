import { parseEventLogs, type Abi, type Address, type Hex } from 'viem';
import { artifact, manifest, publicClient } from './shared.js';

const abi=artifact('DemoRegistry').abi as Abi;
export type ChainHolding={id:Hex;originatorAddress:Address;identity:Hex;units:bigint;name:string;instrument:string;originator:string};
export async function allHoldings():Promise<ChainHolding[]> {
 const m=manifest(),logs=await publicClient.getLogs({address:m.registry,fromBlock:0n,toBlock:'latest'});
 const events=parseEventLogs({abi,logs,eventName:'HoldingRegistered',strict:false});
 return events.map(event=>{
  const a=event.args as {id:Hex;originator:Address;identity:Hex;units:bigint};
  const known=m.holdings.find(h=>h.id.toLowerCase()===a.id.toLowerCase());
  return {id:a.id,originatorAddress:a.originator,identity:a.identity,units:a.units,name:known?.name??`Registered TEST claim ${a.id.slice(2,10)}`,instrument:known?.instrument??'TEST fund claim',originator:known?.originator??m.originators.find(o=>o.address.toLowerCase()===a.originator.toLowerCase())?.name??'TEST originator'};
 });
}
