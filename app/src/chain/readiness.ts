import {isAddressEqual,type Address} from 'viem';
import {CHAIN} from './config';
import type {Advance,Platform,Snapshot} from './model';
export interface ReadinessCheck {id:string;label:string;status:'ready'|'blocked'|'unknown';detail:string}
export interface JudgeReadiness {platform?:Platform;checks:ReadinessCheck[];canFund:boolean;exitPreconditionsMet:boolean;canProcessWindow:boolean;isIssuer:boolean;isOperator:boolean;ownAdvances:Advance[];historicalAdvances:Advance[]}
const same=(a?:Address,b?:Address)=>Boolean(a&&b&&isAddressEqual(a,b));
export function judgeReadiness(snapshot:Snapshot|null,account?:Address,chainId?:number,now=Date.now(),platformAddress?:Address):JudgeReadiness {
 const live=snapshot?.mode==='live';
 const matching=Boolean(live&&same(snapshot?.account,account));
 const networkReady=chainId===CHAIN.id;
 const platform=snapshot?.platforms.find(p=>same(p.address,platformAddress)) ?? snapshot?.platforms.find(p=>p.holding>0n || p.requests.some(r=>r.status==='Queued'&&same(r.owner,account))) ?? snapshot?.platforms.find(p=>p.nextWindow>BigInt(Math.floor(now/1000))) ?? snapshot?.platforms[0];
 const future=Boolean(platform&&platform.nextWindow>BigInt(Math.floor(now/1000)));
 const hasHolding=Boolean(matching&&platform&&platform.holding>0n);
 const queued=Boolean(matching&&platform?.requests.some(r=>r.status==='Queued'&&same(r.owner,account)));
 const capacity=Boolean(platform&&platform.registered!==false&&snapshot&&snapshot.creditLine.capital>0n&&platform.limit>platform.exposure&&!snapshot.creditLine.paused);
 const checks:ReadinessCheck[]=[
  {id:'mode',label:'Live testnet data',status:!snapshot?'unknown':live?'ready':'blocked',detail:!snapshot?'Waiting for a chain read. Refresh if the connection is unavailable.':live?'Reading the deployed Arbitrum Sepolia contracts.':'Preview is illustrative; wallet transactions are disabled.'},
  {id:'wallet',label:'Connected wallet',status:account?'ready':'blocked',detail:account?'A wallet is connected; transaction permissions are checked separately.':'Connect your own wallet to read its positions and balances.'},
  {id:'network',label:'Arbitrum Sepolia',status:chainId===undefined?'unknown':networkReady?'ready':'blocked',detail:chainId===undefined?'Wallet network has not been checked.':networkReady?'The wallet reports chain421614.':'Switch to Arbitrum Sepolia. No Lockgate deployment is available on Arbitrum One.'},
  {id:'snapshot',label:'Wallet position data',status:matching?'ready':account?'unknown':'blocked',detail:matching?'Balances and requests match this wallet.':'Refresh live data after connecting or changing accounts.'},
  {id:'usdg',label:'USDG for a new position',status:!matching?'unknown':snapshot!.usdgBalance>0n?'ready':'blocked',detail:!matching?'Wallet token balance has not been read.':snapshot!.usdgBalance>0n?'The wallet holds testnet USDG. Choose an amount within this balance.':'This wallet has no USDG. No automatic faucet or funding service is connected.'},
  {id:'position',label:'Position available to quote',status:hasHolding||queued?'ready':!matching?'unknown':'blocked',detail:hasHolding?'Available shares were read from this wallet.':queued?'This wallet has a queued redemption that can be quoted.':'Fund a position first, or inspect a historical receipt separately.'},
  {id:'eligibility',label:'Platform eligibility and gate',status:!platform?'unknown':platform.gated?'blocked':platform.blocked&&!hasHolding&&!queued?'blocked':'ready',detail:!platform?'No deployed platform is available.':platform.gated?'Issuer gate is closed. A deposit does not make an early exit available.':platform.blocked?'New deposits are blocked by the issuer. Existing positions still require a live exit quote.':'No issuer gate or deposit block is reported.'},
  {id:'capacity',label:'Credit-line headroom',status:!snapshot||!platform?'unknown':capacity?'ready':'blocked',detail:!snapshot||!platform?'Liquidity has not been read.':snapshot.creditLine.paused?'The credit line is paused.':platform.registered===false?'This platform is not registered for new advances.':capacity?'Cash and platform headroom exist; the actual quote still checks amount, reserve, utilization and pricing.':'No cash or platform headroom is currently available.'},
  {id:'window',label:'Future settlement window',status:!platform?'unknown':future?'ready':'blocked',detail:!platform?'No settlement clock is available.':future?'The next window is in the future. Confirm availability with a fresh quote.':'The window is due. Anyone may attempt settlement; insufficient cash can prevent it rolling. Refresh afterward.'},
 ];
 const active=Boolean(live&&account&&networkReady&&matching&&platform);
 return {platform,checks,canFund:Boolean(active&&!platform!.blocked&&snapshot!.usdgBalance>0n),exitPreconditionsMet:Boolean(active&&(hasHolding||queued)&&!platform!.gated&&capacity&&future),canProcessWindow:Boolean(active&&!future),isIssuer:Boolean(active&&same(platform!.issuer,account)),isOperator:Boolean(active&&same(snapshot!.creditLine.owner,account)),ownAdvances:matching?snapshot!.creditLine.advances.filter(a=>same(a.to,account)):[],historicalAdvances:live?snapshot!.creditLine.advances:[]};
}
