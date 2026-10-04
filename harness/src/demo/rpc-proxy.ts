import { z } from 'zod';
import { err, rpc } from './shared.js';

// Reads only. Wallet signatures and broadcasts stay in the user's wallet.
const methods=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount']);
const call=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.number(),z.string()]),method:z.string().refine(m=>methods.has(m),'Unsupported RPC method'),params:z.array(z.unknown()).max(10).default([])}).strict();
const input=z.union([call,z.array(call).min(1).max(50)]);
let windowStart=Date.now(),requests=0;
export async function proxyRpc(value:unknown) {
 const parsed=input.parse(value);
 if(Date.now()-windowStart>60_000){windowStart=Date.now();requests=0;}
 requests+=Array.isArray(parsed)?parsed.length:1;
 if(requests>3000)err('RPC rate limit reached. Try again shortly.','RATE_LIMITED',429);
 const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(parsed),signal:AbortSignal.timeout(15_000)});
 if(!response.ok)err('Network provider is temporarily unavailable.','RPC_UNAVAILABLE',503);
 const result:unknown=await response.json();
 const sanitize=(item:unknown)=>{
  const data=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.number(),z.string(),z.null()]),result:z.unknown().optional(),error:z.object({code:z.number(),message:z.string()}).optional()}).parse(item);
  return data.error?{jsonrpc:'2.0',id:data.id,error:{code:data.error.code,message:'Network request could not be completed.'}}:data;
 };
 return Array.isArray(result)?result.map(sanitize):sanitize(result);
}
