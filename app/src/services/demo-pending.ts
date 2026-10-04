import { z } from 'zod';
import type { Address, Hex } from 'viem';
import type { Receipt } from '../demo/types';
const key='lockgate.local-demo.pending.v1';
const schema=z.array(z.object({id:z.string(),title:z.string(),status:z.literal('unknown'),hash:z.string().regex(/^0x[\da-f]{64}$/i),amount:z.string().optional(),createdAt:z.string(),account:z.string().regex(/^0x[\da-f]{40}$/i),detail:z.string()}));
export function pending(account:Address):Receipt[] {
 try {return schema.parse(JSON.parse(localStorage.getItem(key)||'[]')).filter(r=>r.account.toLowerCase()===account.toLowerCase()) as Receipt[];}catch{return [];}
}
function write(items:Receipt[]){try{localStorage.setItem(key,JSON.stringify(items));}catch{/* The visible receipt still retains its hash. */}}
export function rememberPending(account:Address,hash:Hex,title:string,amount?:string):Receipt {
 const record:Receipt={id:hash,title,status:'unknown',hash,amount,createdAt:new Date().toISOString(),account,detail:'Submitted transaction. Confirmation is being checked; do not retry the transfer.'};
 let all:Receipt[]=[];try{all=schema.parse(JSON.parse(localStorage.getItem(key)||'[]')) as Receipt[];}catch{/* Invalid storage grants no financial authority. */}
 write([...all.filter(r=>r.hash!==hash),record]);return record;
}
export function clearPending(hash:Hex){let all:Receipt[]=[];try{all=schema.parse(JSON.parse(localStorage.getItem(key)||'[]')) as Receipt[];}catch{return;}write(all.filter(r=>r.hash!==hash));}
