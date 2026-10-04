import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('lost broadcast response recovers the durable transaction without another nonce or payment',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lockgate-transaction-test-'));
 try{
  const result=await build({stdin:{contents:`export * from './src/demo/transactions.ts'; export { control } from 'test-runtime';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'simulated-chain-and-disk',setup(builder){
   builder.onResolve({filter:/test-runtime|shared\.js$/},()=>({path:'runtime',namespace:'test'}));
   builder.onResolve({filter:/filesystem\.js$/},()=>({path:'filesystem',namespace:'test'}));
   builder.onLoad({filter:/.*/,namespace:'test'},args=>({loader:'js',contents:args.path==='filesystem'?`
    import {control} from 'test-runtime';
    export function readFileSync(path){if(!control.files.has(path))throw Object.assign(new Error('Missing'),{code:'ENOENT'});return control.files.get(path);}
    export function writeFileSync(path,value){control.files.set(path,value);control.events.push('persist');}
    export function renameSync(from,to){control.files.set(to,control.files.get(from));control.files.delete(from);}
    export function mkdirSync(){}
    export async function flushDurability(){control.events.push('durable');}
   `:`
    export const control={files:new Map(),events:[],prepared:0,raw:[],failBroadcast:true};
    export const publicNetwork=true;
    export const accountAt=()=>({address:'0x1111111111111111111111111111111111111111'});
    export function err(message,code,status){throw Object.assign(new Error(message),{code,status});}
    export const walletAt=()=>({account:accountAt(),async prepareTransactionRequest(){control.prepared++;return {};},async signTransaction(){return '0xabcdef';}});
    export const publicClient={
     async getTransactionReceipt(){throw new Error('Not found');},
     async sendRawTransaction({serializedTransaction}){control.events.push('broadcast');control.raw.push(serializedTransaction);if(control.failBroadcast)throw new Error('Lost response');return '0x123';},
     async getTransaction(){throw new Error('Not found');},
     async waitForTransactionReceipt(){return {status:'success'};}
    };
   `}));
  }}]});
  const file=resolve(directory,'test.mjs');await writeFile(file,result.outputFiles[0].text);
  const {gasTransaction,control}=await import(pathToFileURL(file).href);
  const recipient='0x2222222222222222222222222222222222222222';
  await assert.rejects(gasTransaction(0,recipient,500n),{code:'TRANSACTION_PENDING'});
  assert.deepEqual(control.events.slice(0,3),['persist','durable','broadcast']);
  await assert.rejects(gasTransaction(0,'0x3333333333333333333333333333333333333333',500n),{code:'TRANSACTION_PENDING'});
  assert.equal(control.prepared,1,'Unresolved signer nonce must block a different payment');
  control.failBroadcast=false;
  const hash=await gasTransaction(0,recipient,500n);
  assert.match(hash,/^0x[0-9a-f]{64}$/);
  assert.equal(control.prepared,1,'Recovery must not prepare or sign a new nonce');
  assert.deepEqual(control.raw,['0xabcdef','0xabcdef'],'Broadcasts must carry the exact signed transaction');
  assert.equal(await gasTransaction(0,recipient,500n),hash);
  assert.equal(control.raw.length,2,'Completed action must not broadcast again');
 }finally{await rm(directory,{recursive:true,force:true});}
});
