import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { privateKeyToAccount } from '../harness/node_modules/viem/_esm/accounts/index.js';
const path=new URL('.wrangler/restart-check.json',import.meta.url),base='http://127.0.0.1:8791/api/demo/';
const call=async(name,body,token)=>{const response=await fetch(base+name,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()};};
if(process.argv.includes('--prepare')){
 const wallet=privateKeyToAccount(`0x${'8'.repeat(64)}`);
 const auth=async()=>{const c=await call('challenge',{account:wallet.address,chainId:421614});assert.equal(c.status,200);return {account:wallet.address,chainId:421614,...c.value,signature:await wallet.signMessage({message:c.value.message})};};
 const signed=await call('authenticate',await auth());assert.equal(signed.status,200);
 const token=signed.value.token;assert.equal((await call('role',{role:'provider'},token)).status,200);
 const pending=await auth();await mkdir(new URL('.wrangler/',import.meta.url),{recursive:true});await writeFile(path,JSON.stringify({token,pending}),{mode:0o600});
 process.stdout.write('Prepared session, profile mutation and unconsumed challenge for runtime restart.\n');
}else{
 const {token,pending}=JSON.parse(await readFile(path,'utf8'));
 const state=await call('state',undefined,token);assert.equal(state.status,200);assert.equal(state.value.profile.activeRole,'provider');
 assert.equal((await call('authenticate',pending)).status,200);
 assert.equal((await call('authenticate',pending)).status,401);
 process.stdout.write('Persisted session, profile and challenge survived Worker reload; replay rejected.\n');
}
