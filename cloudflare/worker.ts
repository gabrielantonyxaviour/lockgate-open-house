import { DurableObject } from 'cloudflare:workers';
import { parseImport } from './import-state.js';
import { bufferedRequest } from './request-body.js';
import { withStorage } from './filesystem.js';
import { apiResponse } from './http-adapter.js';
import { challenges } from '../harness/src/demo/server.js';
import { reloadStore } from '../harness/src/demo/store.js';

type Env={ASSETS:Fetcher;LOCKGATE_API:DurableObjectNamespace;LOCKGATE_IMPORT_TOKEN?:string};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const statePath='/lockgate/scripts/demo/local/public-sepolia-state.json';

export class LockgateApi extends DurableObject<Env>{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS documents(key TEXT PRIMARY KEY,value TEXT NOT NULL)');}
 fetch(request:Request){
  const job=this.queue.then(()=>withStorage(this.ctx.storage,()=>this.respond(request)));
  this.queue=job.catch(()=>undefined);return job;
 }
 private async respond(request:Request):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(path==='/api/demo/admin/import')return this.importState(request);
  if(!this.ctx.storage.sql.exec('SELECT value FROM documents WHERE key = ?',statePath).toArray().length)return json({error:'Service initialization is pending',code:'SERVICE_INITIALIZING'},503);
  reloadStore();
  challenges.clear();
  const saved=this.ctx.storage.sql.exec('SELECT value FROM documents WHERE key = ?','auth-challenges').toArray()[0];
  if(saved)for(const [key,value]of JSON.parse(String(saved.value)))challenges.set(key,value);
  try{return await apiResponse(request);}
  finally{this.ctx.storage.sql.exec('INSERT INTO documents(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','auth-challenges',JSON.stringify([...challenges]));}
 }
 private async importState(request:Request){
  if(!this.env.LOCKGATE_IMPORT_TOKEN||request.headers.get('authorization')!==`Bearer ${this.env.LOCKGATE_IMPORT_TOKEN}`)return json({error:'Not found',code:'NOT_FOUND'},404);
  if(request.method!=='POST')return json({error:'Method not allowed',code:'METHOD_NOT_ALLOWED'},405);
  if(this.ctx.storage.sql.exec('SELECT value FROM documents WHERE key = ?',statePath).toArray().length)return json({error:'State was already initialized',code:'ALREADY_INITIALIZED'},409);
  let parsed;try{parsed=await parseImport(request);}catch{return json({error:'Invalid state import',code:'INVALID_INPUT'},400);}
  this.ctx.storage.transactionSync(()=>{
   this.ctx.storage.sql.exec('INSERT INTO documents(key,value) VALUES(?,?)',statePath,JSON.stringify(parsed.state));
   for(const [reference,item]of Object.entries(parsed.outbox))this.ctx.storage.sql.exec('INSERT INTO documents(key,value) VALUES(?,?)',`/lockgate/scripts/demo/local/email/${reference}.json`,JSON.stringify(item));
  });
  return json({imported:true,profiles:Object.keys(parsed.state.profiles).length,enquiries:parsed.state.enquiries.length,outbox:Object.keys(parsed.outbox).length});
 }
}

export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.hostname==='open-house.lockgate.finance'){url.hostname='openhouse.lockgate.finance';url.protocol='https:';return Response.redirect(url.toString(),301);}
  if(url.pathname.startsWith('/api/')){
   if(!url.pathname.startsWith('/api/demo/'))return json({error:'Not found',code:'NOT_FOUND'},404);
   let buffered;try{buffered=await bufferedRequest(request,url.pathname==='/api/demo/admin/import'?8_000_000:65536);}catch{return json({error:'Request too large',code:'REQUEST_TOO_LARGE'},413);}
   try{return await env.LOCKGATE_API.get(env.LOCKGATE_API.idFromName('arbitrum-sepolia-production-v1')).fetch(buffered);}catch{return json({error:'Service temporarily unavailable',code:'SERVICE_UNAVAILABLE'},503);}
  }
  return env.ASSETS.fetch(request);
 }
};
