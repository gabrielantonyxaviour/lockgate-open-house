import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proxyRpc} from '../src/demo/rpc-proxy.js';

const call=(method:string,params:unknown[]=[])=>({jsonrpc:'2.0',id:1,method,params});

async function withFetch(impl:typeof fetch,run:()=>Promise<void>) {
 const original=globalThis.fetch;
 globalThis.fetch=impl;
 try {await run();} finally {globalThis.fetch=original;}
}

async function rejectBeforeUpstream(cases:unknown[]) {
 let upstreamCalls=0;
 await withFetch(async()=>{upstreamCalls++;throw new Error('Invalid RPC reached upstream');},async()=>{
  for(const value of cases)await assert.rejects(()=>proxyRpc(value));
 });
 assert.equal(upstreamCalls,0,'Denied calls must never reach the RPC provider');
}

test('RPC proxy rejects broadcasts, signatures, wallet, admin, and Anvil methods before fetch',async()=>{
 const methods=[
  'eth_sendRawTransaction','eth_sendTransaction','eth_sign','personal_sign',
  'eth_signTypedData','eth_signTypedData_v3','eth_signTypedData_v4',
  'wallet_switchEthereumChain','wallet_addEthereumChain',
  'anvil_setBalance','anvil_impersonateAccount','hardhat_setBalance',
  'evm_mine','evm_setNextBlockTimestamp','debug_traceTransaction',
 ];
 await rejectBeforeUpstream(methods.map(method=>call(method)));
});

test('RPC proxy rejects malformed JSON-RPC envelopes and mixed batches before fetch',async()=>{
 await rejectBeforeUpstream([
  null,{},[],{...call('eth_chainId'),jsonrpc:'1.0'},
  {jsonrpc:'2.0',id:null,method:'eth_chainId',params:[]},
  {jsonrpc:'2.0',id:true,method:'eth_chainId',params:[]},
  {jsonrpc:'2.0',id:1,params:[]},
  {...call('eth_chainId'),params:{}},
  {...call('eth_chainId'),unexpected:'extra'},
  [call('eth_chainId'),call('eth_sendRawTransaction',['0xdead'])],
 ]);
});

test('RPC proxy enforces a maximum of 50 batch calls and 10 positional params',async()=>{
 await rejectBeforeUpstream([
  Array.from({length:51},(_,id)=>({...call('eth_blockNumber'),id})),
  call('eth_call',Array(11).fill('0x')),
  [call('eth_chainId'),call('eth_call',Array(11).fill('0x'))],
 ]);
});

test('RPC proxy forwards allowed reads and strips unsolicited upstream fields',async()=>{
 const query=[call('eth_chainId'),{...call('eth_getBalance',['0x0000000000000000000000000000000000000001','latest']),id:'balance'}];
 let forwarded:unknown,fetchCount=0;
 await withFetch(async(_url,init)=>{
  fetchCount++;assert.equal(init?.method,'POST');assert.equal((init?.headers as Record<string,string>)['content-type'],'application/json');
  forwarded=JSON.parse(String(init?.body));
  return new Response(JSON.stringify([
   {jsonrpc:'2.0',id:1,result:'0x66eee',untrusted:'provider metadata'},
   {jsonrpc:'2.0',id:'balance',result:'0x64',untrusted:{credential:'do not return'}},
  ]),{status:200});
 },async()=>{
  const result=await proxyRpc(query);
  assert.deepEqual(result,[{jsonrpc:'2.0',id:1,result:'0x66eee'},{jsonrpc:'2.0',id:'balance',result:'0x64'}]);
 });
 assert.equal(fetchCount,1);assert.deepEqual(forwarded,query);
});

test('RPC proxy sanitizes provider errors and never returns upstream data or message',async()=>{
 await withFetch(async()=>new Response(JSON.stringify({
  jsonrpc:'2.0',id:7,error:{code:-32000,message:'QuickNode credential and account details',data:{private:'do not return'}},
  upstreamTrace:'do not return',
 }),{status:200}),async()=>{
  const result=await proxyRpc({...call('eth_getTransactionReceipt',['0x1234']),id:7});
  assert.deepEqual(result,{jsonrpc:'2.0',id:7,error:{code:-32000,message:'Network request could not be completed.'}});
  assert.equal(JSON.stringify(result).includes('credential'),false);
 });
 await withFetch(async()=>new Response('QuickNode private response',{status:503}),async()=>{
  await assert.rejects(()=>proxyRpc(call('eth_chainId')),(error:unknown)=>{
   const e=error as Error&{code?:string;status?:number};
   assert.equal(e.code,'RPC_UNAVAILABLE');assert.equal(e.status,503);
   assert.equal(e.message,'Network provider is temporarily unavailable.');
   assert.equal(e.message.includes('QuickNode'),false);
   return true;
  });
 });
});
