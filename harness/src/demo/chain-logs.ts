import type { Address, Log } from 'viem';
import { manifest, publicClient } from './shared.js';

/** Restrict scans to this deployment and provider-compatible block windows. */
export async function chainLogs(address:Address):Promise<Log[]> {
 const from=BigInt(manifest().deploymentBlock??'0');
 const head=await publicClient.getBlockNumber({cacheTime:0});
 const logs:Log[]=[];
 for(let start=from;start<=head;start+=2000n){
  const end=start+1999n<head?start+1999n:head;
  logs.push(...await publicClient.getLogs({address,fromBlock:start,toBlock:end}));
 }
 return logs;
}
