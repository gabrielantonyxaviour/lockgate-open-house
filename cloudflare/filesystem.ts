import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from 'cloudflare:workers';
import files from './build/static-files.json';

type Sql={exec(query:string,...bindings:unknown[]):{toArray():{value:string}[]}};
type Storage={sql:Sql;sync():Promise<void>};
const scope=new AsyncLocalStorage<Storage>();
export const withStorage=<T>(storage:Storage,callback:()=>T):T=>scope.run(storage,callback);
const pathOf=(path:unknown)=>String(path instanceof URL?path.pathname:path);
const missing=()=>Object.assign(new Error('Stored document not found'),{code:'ENOENT'});
function database(){const sql=scope.getStore();if(!sql)throw new Error('Durable storage context is required');return sql.sql;}
export function readFileSync(path:unknown,_encoding?:unknown):string {
 const key=pathOf(path),name=key.split('/').at(-1)!;
 if(name==='public-sepolia-signers.json'){
  if(!env.LOCKGATE_SIGNERS_JSON)throw new Error('Signer secret is unavailable');
  return String(env.LOCKGATE_SIGNERS_JSON);
 }
 if(Object.hasOwn(files,name))return (files as Record<string,string>)[name];
 const row=database().exec('SELECT value FROM documents WHERE key = ?',key).toArray()[0];
 if(!row)throw missing();return row.value;
}
export function writeFileSync(path:unknown,value:unknown,_options?:unknown):void {
 database().exec('INSERT INTO documents(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',pathOf(path),String(value));
}
export function renameSync(from:unknown,to:unknown):void {
 const value=readFileSync(from);writeFileSync(to,value);database().exec('DELETE FROM documents WHERE key = ?',pathOf(from));
}
export function mkdirSync(_path:unknown,_options?:unknown):void {}
export function statSync(_path:unknown){return {mode:0o600};}

export async function flushDurability(){const storage=scope.getStore();if(!storage)throw new Error("Durable storage context is required");await storage.sync();}
