import { createPublicClient, http, isAddressEqual, zeroAddress, type Abi, type Address } from 'viem';
import { z } from 'zod';
import { platformAbi, creditLineAbi, tokenAbi, vaultAbi } from './abi';
import { CHAIN, DEPLOYMENT, RPC_URL } from './config';
import type { Advance, ExitQuote, PartnerVault, Platform, RedemptionRequest, Snapshot } from './model';
export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL, { batch: true, timeout: 15_000, retryCount: 1 }) });
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value as Address);
export function checkedAddress(value: string): Address { return addressSchema.parse(value); }
const same = (a?: Address, b?: Address) => Boolean(a && b && isAddressEqual(a, b));
export async function read<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
 return await publicClient.readContract({ address, abi, functionName, args, blockNumber }) as T;
}
async function readPlatform(address: Address, account: Address | undefined, blockNumber: bigint): Promise<Platform> {
 const p = <T>(name: string, args: readonly unknown[] = []) => read<T>(address, platformAbi, name, args, blockNumber);
 const l = <T>(name: string) => read<T>(DEPLOYMENT.creditLine, creditLineAbi, name, [address], blockNumber);
 const [name, share, issuer, nav, cash, nextWindow, windowInterval, gated, queueLength, queuedValue, limit, exposure, reserve, settlementTuple] = await Promise.all([
  p<string>('name'), p<Address>('share'), p<Address>('issuer'), p<bigint>('nav'), p<bigint>('cash'), p<bigint>('nextWindow'), p<bigint>('windowInterval'), p<boolean>('gated'), p<bigint>('queueLength'), p<bigint>('queuedValue'), l<bigint>('limitOf'), l<bigint>('exposure'), l<bigint>('reserveOf'), p<readonly [bigint,bigint,bigint,bigint]>('previewSettlement'),
 ]);
 const [holding, blocked, ids] = account ? await Promise.all([
  read<bigint>(share, tokenAbi, 'balanceOf', [account], blockNumber), read<boolean>(share, tokenAbi, 'blocked', [account], blockNumber), p<bigint[]>('requestsOf',[account]),
 ]) : [0n, false, [] as bigint[]];
 if (ids.length > 500) throw new Error('This wallet has more than 500 requests. An indexed history service is required.');
 const requests = await Promise.all(ids.map(async id => ({ id, ...await p<Omit<RedemptionRequest,'id'|'status'> & {status:number}>('getRequest',[id]) })).map(async result => {
  const value = await result;
  return { ...value, status: (['Queued','Advanced','Paid','Cancelled'] as const)[value.status] };
 }));
 const queue: RedemptionRequest[] = [];
 let openId = await p<bigint>('firstOpen');
 while(openId !== 0n) {
  if(queue.length >= 128 || queue.some(r=>r.id===openId)) throw new Error('Invalid platform open-request list.');
  const request = await p<Omit<RedemptionRequest,'id'|'status'> & {status:number}>('getRequest',[openId]);
  queue.push({...request,id:openId,status:(['Queued','Advanced','Paid','Cancelled'] as const)[request.status]});
  openId = await p<bigint>('nextOpen',[openId]);
 }
 const [registered,reserveBps,riskBps] = await Promise.all([l<boolean>('registered'),l<number>('reserveBpsOf'),l<number>('riskOf')]);
 const [cashBalance, repayFirst, queuePayable, queueShortfall] = settlementTuple;
 return { address, name, share, issuer, nav, cash, nextWindow, windowInterval, gated, queueLength, queuedValue, limit, exposure, reserve, holding, blocked, requests, queue, registered, reserveBps, riskBps, settlement:{cashBalance,repayFirst,queuePayable,queueShortfall} };
}
async function readVault(address: Address, name: string, blockNumber: bigint): Promise<PartnerVault> {
 const v = <T>(fn: string) => read<T>(address, vaultAbi, fn, [], blockNumber);
 const [owner,idle,reserveCash,outstandingPrincipal,totalAssets,paused,mandate,approvedPlatforms,advanceCount] = await Promise.all([
  v<Address>('owner'),v<bigint>('idle'),v<bigint>('reserveCash'),v<bigint>('outstandingPrincipal'),v<bigint>('totalAssets'),v<boolean>('paused'),v<PartnerVault['mandate']>('mandate'),v<Address[]>('approvedPlatforms'),v<bigint>('advanceCount'),
 ]);
 if(advanceCount>500n) throw new Error('Partner history requires an indexed service above 500 advances.');
 const advances = await Promise.all(Array.from({length:Number(advanceCount)}, async (_,i)=>({id:BigInt(i+1),...await read<Omit<import('./model').PartnerAdvance,'id'>>(address,vaultAbi,'getAdvance',[BigInt(i+1)],blockNumber)})));
 const platformTerms = await Promise.all(approvedPlatforms.map(async platform=>{
  const [config,exposure,reserve]=await Promise.all([read<Omit<import('./model').VaultPlatformTerms,'platform'|'exposure'|'reserve'>>(address,vaultAbi,'platformConfig',[platform],blockNumber),read<bigint>(address,vaultAbi,'exposureOf',[platform],blockNumber),read<bigint>(address,vaultAbi,'reserveOf',[platform],blockNumber)]);
  return {...config,platform,exposure,reserve};
 }));
 return {address,name,owner,idle,reserveCash,outstandingPrincipal,totalAssets,paused,mandate,approvedPlatforms,advanceCount,proposals:[],advances,platformTerms};
}
export async function loadSnapshot(account?: Address): Promise<Snapshot> {
 if (account) checkedAddress(account);
 if (await publicClient.getChainId() !== CHAIN.id) throw new Error('The RPC is not Arbitrum Sepolia.');
 const block = await publicClient.getBlock();
 const blockNumber = block.number;
 const l = <T>(fn:string,args:readonly unknown[] = []) => read<T>(DEPLOYMENT.creditLine,creditLineAbi,fn,args,blockNumber);
 const [sources,owner,capital,outstanding,totalExposure,earnedFees,lateOutstanding,utilizationBps,paused,advanceCount,usdgBalance] = await Promise.all([
  l<Address[]>('sources'),l<Address>('owner'),l<bigint>('capital'),l<bigint>('outstanding'),l<bigint>('totalExposure'),l<bigint>('earnedFees'),l<bigint>('lateOutstanding'),l<number>('utilizationBps'),l<boolean>('paused'),l<bigint>('advanceCount'),account ? read<bigint>(DEPLOYMENT.usdg,tokenAbi,'balanceOf',[account],blockNumber) : Promise.resolve(0n),
 ]);
 if (advanceCount > 500n) throw new Error('More than 500 advances require an indexed history service.');
 const [maxUtilizationBps,maxConcentrationBps,grace] = await Promise.all([l<number>('maxUtilizationBps'),l<number>('maxConcentrationBps'),l<bigint>('grace')]);
 const advances = await Promise.all(Array.from({length:Number(advanceCount)},async (_,index):Promise<Advance> => {
  const id = BigInt(index+1);
  const [a,remaining,recovered,grace] = await Promise.all([l<Omit<Advance,'id'|'status'|'remaining'|'recovered'|'grace'> & {status:number}>('getAdvance',[id]),l<bigint>('remainingOf',[id]),l<bigint>('recoveredOf',[id]),l<bigint>('graceOf',[id])]);
  return {...a,id,status:(['Active','Repaid','Late'] as const)[a.status],remaining,recovered,grace};
 }));
 const platforms = await Promise.all(sources.map(source => readPlatform(source,account,blockNumber)));
 const vaultResults = await Promise.allSettled([readVault(DEPLOYMENT.vaultA,'Partner vault A',blockNumber),readVault(DEPLOYMENT.vaultB,'Partner vault B',blockNumber)]);
 const vaults: PartnerVault[] = [];
 const warnings = ['Partner proposal terms require the engine payload feed; the contract stores only hashes, not an enumerable approval inbox.'];
 vaultResults.forEach((result,index) => result.status==='fulfilled' ? vaults.push(result.value) : warnings.push(`Partner vault ${index+1} could not be read: ${errorMessage(result.reason)}`));
 return {mode:'live',blockNumber,observedAt:Number(block.timestamp)*1000,account,usdgBalance,roles:{operator:same(account,owner),issuerPlatforms:platforms.filter(p=>same(p.issuer,account)).map(p=>p.address),partnerVaults:vaults.filter(v=>same(v.owner,account)).map(v=>v.address)},platforms,creditLine:{owner,capital,outstanding,totalExposure,earnedFees,lateOutstanding,utilizationBps,paused,maxUtilizationBps,maxConcentrationBps,grace,advances},vaults,warnings};
}
export async function quoteExit(platform: Address, shares: bigint): Promise<ExitQuote> { return quote(platform,'quoteExit',shares); }
export async function quoteRequest(platform: Address, requestId: bigint): Promise<ExitQuote> { return quote(platform,'quoteRequest',requestId); }
async function quote(platform:Address, fn:string, value:bigint):Promise<ExitQuote> {
 checkedAddress(platform);
 if(value <= 0n) throw new Error('Enter a positive amount or request ID.');
 const blockNumber = await publicClient.getBlockNumber();
 const [navValue,fee,usdgOut,available,reason] = await read<readonly [bigint,bigint,bigint,boolean,string]>(platform,platformAbi,fn,[value],blockNumber);
 return {navValue,fee,usdgOut,available,reason,blockNumber,quotedAt:Date.now()};
}
export function errorMessage(error: unknown): string {
 if(typeof error==='object' && error && 'code' in error && error.code===4001) return 'Wallet request rejected. Try again when you are ready.';
 if(error instanceof Error) return error.message.split('\n')[0].slice(0,240);
 return 'The network request failed. Try again.';
}
export const EMPTY_ADDRESS = zeroAddress;
