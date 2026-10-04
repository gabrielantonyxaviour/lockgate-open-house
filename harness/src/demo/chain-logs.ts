import type { Address, Log } from 'viem';
import { manifest, publicClient } from './shared.js';

/** Restrict scans to this deployment and provider-compatible block windows. */
export async function chainLogs(address:Address):Promise<Log[]> {
 const from=BigInt(manifest().deploymentBlock??'0');
 const head=await publicClient.getBlockNumber({cacheTime:0});
 const logs:Log[]=[];
 // Bounded concurrency keeps every read fresh without serializing the entire history.
 for(let batch=from;batch<=head;batch+=8000n){
  const windows=[];
  for(let start=batch;start<=head&&start<batch+8000n;start+=2000n){
   const end=start+1999n<head?start+1999n:head;
   windows.push(publicClient.getLogs({address,fromBlock:start,toBlock:end}));
  }
  for(const window of await Promise.all(windows))logs.push(...window);
 }
 return logs;
}
