import { encodeFunctionData, keccak256, toHex, type Abi, type Address, type Hex } from 'viem';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, renameSync, mkdirSync, flushDurability } from './filesystem.js';
import { accountAt, err, publicClient, publicNetwork, walletAt } from './shared.js';

type Transaction={signer:Address;hash:Hex;raw:Hex;status:'pending'|'confirmed'|'reverted'};
type Journal=Record<string,Transaction>;
const directory=fileURLToPath(new URL('../../../scripts/demo/local/',import.meta.url));
const path=`${directory}${publicNetwork?'public-sepolia':'local'}-runtime-transactions.json`;
const keyFor=(index:number,to:Address,data:Hex,value:bigint)=>keccak256(toHex(`${accountAt(index).address}:${to.toLowerCase()}:${data}:${value}`));
function journal():Journal{try{return JSON.parse(readFileSync(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return {};}}
async function persist(records:Journal){mkdirSync(directory,{recursive:true});writeFileSync(`${path}.tmp`,JSON.stringify(records),{mode:0o600});renameSync(`${path}.tmp`,path);await flushDurability();}
let queue:Promise<unknown>=Promise.resolve();
export function contractTransaction(index:number,address:Address,abi:Abi,functionName:string,args:readonly unknown[]){return send(index,address,encodeFunctionData({abi,functionName,args}),0n);}
export function knownContractTransaction(index:number,address:Address,abi:Abi,functionName:string,args:readonly unknown[]){return Boolean(journal()[keyFor(index,address,encodeFunctionData({abi,functionName,args}),0n)]);}
export function gasTransaction(index:number,address:Address,value:bigint){return send(index,address,'0x',value);}
function send(index:number,to:Address,data:Hex,value:bigint):Promise<Hex>{
 const job=queue.then(()=>execute(index,to,data,value));queue=job.catch(()=>undefined);return job;
}
async function execute(index:number,to:Address,data:Hex,value:bigint):Promise<Hex>{
 const records=journal(),key=keyFor(index,to,data,value),wallet=walletAt(index);
 let record=records[key];
 if(!record){
  if(Object.values(records).some(item=>item.signer===wallet.account.address&&item.status==='pending'))err('A previous transaction is pending; resume that action before starting another','TRANSACTION_PENDING',409);
  const request=await wallet.prepareTransactionRequest({to,data,value});
  const raw=await wallet.signTransaction(request);
  record={signer:wallet.account.address,hash:keccak256(raw),raw,status:'pending'};records[key]=record;
  await persist(records);
 }
 if(record.status==='reverted')err('The recorded transaction reverted','CHAIN_REVERT',409);
 if(record.status==='confirmed')return record.hash;
 let receipt=await publicClient.getTransactionReceipt({hash:record.hash}).catch(()=>undefined);
 if(!receipt){
  try{await publicClient.sendRawTransaction({serializedTransaction:record.raw});}
  catch{
   // A successful broadcast may have lost its response. Never create a replacement.
   const pending=await publicClient.getTransaction({hash:record.hash}).catch(()=>undefined);
   if(!pending)err('Transaction submission is pending; retry this same action','TRANSACTION_PENDING',409);
  }
 }
 try{receipt=await publicClient.waitForTransactionReceipt({hash:record.hash,confirmations:publicNetwork?3:1,timeout:90_000});}
 catch{err('Transaction confirmation is pending; retry this same action','TRANSACTION_PENDING',409);}
 record.status=receipt.status==='success'?'confirmed':'reverted';await persist(records);
 if(record.status==='reverted')err('The transaction reverted','CHAIN_REVERT',409);
 return record.hash;
}
