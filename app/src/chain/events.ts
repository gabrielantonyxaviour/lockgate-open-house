import {formatUnits,type Abi,type AbiEvent,type Address,type Hash} from 'viem';
import {z} from 'zod';
import {creditLineAbi,platformAbi,vaultAbi} from './abi';
import {reserveAbi} from './reserve-abi';
import {facilityAbi} from './facility-abi';
import {CHAIN,DEPLOYMENT} from './config';
import {errorMessage,publicClient} from './client';
export interface ChainEvent {id:string;hash:Hash;blockNumber:bigint;kind:'exit'|'repayment'|'reserve'|'partner'|'control';name:string;address:Address;description:string;amount?:bigint}
export interface EventResult {events:ChainEvent[];fromBlock:bigint;toBlock:bigint;warnings:string[]}
interface DecodedLog {address:string;transactionHash:string|null;blockNumber:bigint|null;logIndex:number|null;eventName?:string;args?:unknown;removed?:boolean}
const hashSchema=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressSchema=z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const movement:Record<string,{kind:ChainEvent['kind'];title:string;field?:string}>={
 ExitAdvanced:{kind:'exit',title:'Investor exit paid',field:'usdgOut'},AdvanceDrawn:{kind:'exit',title:'Credit-line advance funded',field:'principal'},
 SharesDeposited:{kind:'control',title:'Investor deposited USDG',field:'usdgAmount'},CashDeposited:{kind:'control',title:'Platform cash deposited',field:'amount'},
 RedeemRequested:{kind:'control',title:'Redemption requested',field:'navValue'},RequestCancelled:{kind:'control',title:'Redemption cancelled'},
 RequestPaid:{kind:'repayment',title:'Redemption paid',field:'amount'},RequestPartPaid:{kind:'repayment',title:'Redemption partially paid',field:'amount'},
 AdvanceRepaid:{kind:'repayment',title:'Advance repaid',field:'amount'},AdvanceClosed:{kind:'repayment',title:'Advanced redemption closed'},
 AdvanceMarkedLate:{kind:'reserve',title:'Advance marked late — reserve recovered',field:'slashed'},AdvanceLate:{kind:'reserve',title:'Partner advance late — reserve recovered',field:'covered'},AdvanceWrittenOff:{kind:'partner',title:'Partner advance written off',field:'principalLost'},
 CapitalDeposited:{kind:'control',title:'Lockgate capital deposited',field:'amount'},CapitalWithdrawn:{kind:'control',title:'Lockgate capital withdrawn',field:'amount'},
 Posted:{kind:'reserve',title:'Platform reserve posted',field:'amount'},Withdrawn:{kind:'reserve',title:'Platform reserve withdrawn',field:'amount'},Slashed:{kind:'reserve',title:'Platform reserve applied to repayment',field:'amount'},
 ReservePosted:{kind:'reserve',title:'Reserve posted',field:'amount'},ReserveWithdrawn:{kind:'reserve',title:'Partner reserve withdrawn',field:'amount'},
 Deposited:{kind:'partner',title:'Partner capital deposited',field:'assets'},WithdrawnPartner:{kind:'partner',title:'Partner capital withdrawn',field:'assets'},
 ProposalSubmitted:{kind:'partner',title:'Engine proposal filed'},ProposalCancelled:{kind:'partner',title:'Partner proposal cancelled'},AdvanceFunded:{kind:'partner',title:'Partner advance funded (NAV)',field:'navValue'},
 WindowProcessed:{kind:'control',title:'Settlement window processed'},NavUpdated:{kind:'control',title:'Issuer updated NAV'},GateSet:{kind:'control',title:'Issuer changed redemption gate'},
 SourceRegistered:{kind:'control',title:'Credit platform registered'},SourceUpdated:{kind:'control',title:'Credit platform terms updated'},SourceDeregistered:{kind:'control',title:'Credit platform deregistered'},CapsSet:{kind:'control',title:'Credit-line caps updated'},GraceSet:{kind:'control',title:'Repayment grace updated'},
 Paused:{kind:'control',title:'Credit line paused'},Unpaused:{kind:'control',title:'Credit line unpaused'},PausedSet:{kind:'control',title:'Partner vault pause updated'},MandateGlobalsSet:{kind:'control',title:'Partner mandate updated'},PlatformSet:{kind:'control',title:'Partner platform terms updated'},PayoutSet:{kind:'control',title:'Partner payout destination updated'},
 FacilityDeposited:{kind:'control',title:'Facility tranche capital deposited',field:'assets'},Redeemed:{kind:'control',title:'Facility tranche shares redeemed',field:'assets'},InterestPaid:{kind:'repayment',title:'Facility lender interest paid',field:'amount'},Drawn:{kind:'control',title:'Facility borrower draw',field:'amount'},Repaid:{kind:'repayment',title:'Facility repayment',field:'amount'},RecoveryEntered:{kind:'control',title:'Facility entered recovery'},LossRecognized:{kind:'control',title:'Facility loss recognized',field:'amount'},LenderApproved:{kind:'control',title:'Facility lender permission updated'},
};
export function chainEventFromLog(log:DecodedLog):ChainEvent|null {
 if(log.removed || log.blockNumber===null || log.logIndex===null || !log.transactionHash || !log.eventName) return null;
 if(!hashSchema.safeParse(log.transactionHash).success || !addressSchema.safeParse(log.address).success || log.blockNumber<0n || !Number.isSafeInteger(log.logIndex) || log.logIndex<0) return null;
 const args=log.args && typeof log.args==='object' && !Array.isArray(log.args) ? log.args as Record<string,unknown> : {};
 const key=log.eventName==='Withdrawn' && 'assets' in args ? 'WithdrawnPartner' : log.eventName==='Deposited' && 'tranche' in args ? 'FacilityDeposited' : log.eventName;
 const spec=movement[key];
 if(!spec) return null;
 const raw=spec.field ? args[spec.field] : undefined;
 if(spec.field && (typeof raw!=='bigint' || raw<0n)) return null;
 const amount=typeof raw==='bigint' ? raw : undefined;
 const description=amount===undefined ? spec.title : `${spec.title} · ${formatUnits(amount,6)} USDG`;
 return {id:`${log.transactionHash}:${log.logIndex}`,hash:log.transactionHash as Hash,blockNumber:log.blockNumber,kind:spec.kind,name:log.eventName,address:log.address as Address,description,amount};
}
export function recentEventRange(toBlock:bigint):{fromBlock:bigint;toBlock:bigint} {
 z.bigint().min(0n).parse(toBlock);
 return {fromBlock:toBlock>9999n ? toBlock-9999n : 0n,toBlock};
}
export async function loadEvents():Promise<EventResult> {
 if(await publicClient.getChainId()!==CHAIN.id) throw new Error('Activity reads require Arbitrum Sepolia.');
 const {fromBlock,toBlock}=recentEventRange(await publicClient.getBlockNumber());
 const warnings:string[]=[];
 let platforms:readonly Address[]=[DEPLOYMENT.platform];
 try {
  platforms=await publicClient.readContract({address:DEPLOYMENT.creditLine,abi:creditLineAbi,functionName:'sources',blockNumber:toBlock});
 } catch(error) {warnings.push(`The registered platform list could not be read; platform activity is incomplete: ${errorMessage(error)}`);}
 const uniquePlatforms=Array.from(new Map(platforms.map(address=>[address.toLowerCase(),address])).values());
 const sources:{address:Address;abi:Abi;label:string}[]=[
  ...uniquePlatforms.map(address=>({address,abi:platformAbi,label:`Platform ${address}`})),
  {address:DEPLOYMENT.creditLine,abi:creditLineAbi,label:'Lockgate credit line'},
  {address:DEPLOYMENT.reserve,abi:reserveAbi,label:'Platform reserve'},
  {address:DEPLOYMENT.vaultA,abi:vaultAbi,label:'Partner vault A'},
  {address:DEPLOYMENT.vaultB,abi:vaultAbi,label:'Partner vault B'},
  {address:DEPLOYMENT.facility,abi:facilityAbi,label:'Institutional facility'},
 ];
 const results=await Promise.allSettled(sources.map(async source=>{
  const events=source.abi.filter((item):item is AbiEvent=>item.type==='event');
  const logs=await publicClient.getLogs({address:source.address,events,fromBlock,toBlock,strict:true});
  return logs.map(log=>chainEventFromLog(log)).filter((event):event is ChainEvent=>event!==null);
 }));
 const all:ChainEvent[]=[];
 results.forEach((result,index)=>result.status==='fulfilled' ? all.push(...result.value) : warnings.push(`${sources[index].label} recent activity could not be read: ${errorMessage(result.reason)}`));
 all.sort((a,b)=>a.blockNumber===b.blockNumber ? Number(b.id.split(':').at(-1))-Number(a.id.split(':').at(-1)) : a.blockNumber>b.blockNumber ? -1 : 1);
 if(all.length>100) warnings.push('Only the newest 100 events in this recent block range are shown.');
 return {events:all.slice(0,100),fromBlock,toBlock,warnings};
}
