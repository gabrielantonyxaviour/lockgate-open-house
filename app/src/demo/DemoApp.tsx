import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { checkedAddress, errorMessage } from '../chain/client';
import { connectWallet, getProvider, subscribeWallet, switchNetwork, walletChainId } from '../chain/wallet';
import { ArbitrumMark, PaxosBrand } from '../ui/Brand';
import { Select } from '../ui/Select';
import { useInputModality } from '../ui/input-modality';
import { Button, Heading, Notice, Records } from './Common';
import { EnquiryForm, IdentityEntry, RoleEntry } from './Entry';
import { DemoSheet } from './DemoSheet';
import { WalletMenu } from './WalletMenu';
import { Investor } from './Investor';
import { Provider } from './Provider';
import { Institution } from './Institution';
import { roles } from './fixtures';
import type { DemoGateway, DemoRole, DemoState, PublicOverview } from './types';
import { PublicHome, PublicTerms } from './Public';
import { useRoute, go } from '../ui/router';
import './demo.css';
const connectionKey='lockgate.wallet.connected.v1';
function remember(value:boolean){try{if(value)localStorage.setItem(connectionKey,'1');else localStorage.removeItem(connectionKey);}catch{/* Storage is optional. */}}
export function DemoApp({gateway}:{gateway:DemoGateway}) {
 useInputModality();
 const route=useRoute();
 const terms=route.split("?")[0].startsWith("/terms");
 const readPublic=()=>void gateway.publicOverview().then(data=>{setOverview(data);setPublicError('');}).catch(e=>setPublicError(errorMessage(e)));
 const [overview,setOverview]=useState<PublicOverview>();
 const [publicError,setPublicError]=useState('');
 useEffect(()=>{let active=true;void gateway.publicOverview().then(data=>{if(active)setOverview(data);}).catch(e=>{if(active)setPublicError(errorMessage(e));});return()=>{active=false;};},[gateway]);
 const [account,setAccount]=useState<Address>();
 const [chainId,setChainId]=useState<number>();
 const [network,setNetwork]=useState<421614|42161>(421614);
 const [state,setState]=useState<DemoState>();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [role,setRole]=useState<DemoRole>();
 const [choose,setChoose]=useState(false);
 const [identity,setIdentity]=useState(false);
 const [demo,setDemo]=useState(false);
 const epoch=useRef(0);
 const operation=useRef(false);
 const liveAccount=useRef<Address|undefined>(undefined);
 liveAccount.current=account;
 const invalidate=useCallback(()=>{epoch.current++;setState(undefined);setRole(undefined);setIdentity(false);setDemo(false);setChoose(false);setError('');},[]);
 const apply=useCallback((next:DemoState)=>{setState(next);setRole(next.profile.activeRole||next.profile.roles[0]);},[]);
 const run=useCallback(async<T,>(task:()=>Promise<T>):Promise<T>=>{
  if(operation.current)throw new Error('A wallet operation is already in progress.');
  operation.current=true;const revision=epoch.current;setBusy(true);setError('');
  try{return await task();}catch(e){if(revision===epoch.current)setError(errorMessage(e));throw e;}finally{operation.current=false;setBusy(false);}
 },[]);
 const authenticate=async(address=account)=>{if(!address)return;const revision=epoch.current;const current=await walletChainId();setChainId(current);const next=await gateway.authenticate(address,current);if(revision===epoch.current&&liveAccount.current?.toLowerCase()===address.toLowerCase())apply(next);};
 const refresh=useCallback(async()=>{if(!account)return;const revision=epoch.current;const next=await gateway.refresh(account,chainId||0);if(revision===epoch.current)apply(next);},[account,chainId,gateway,apply]);
 const connect=()=>{invalidate();void run(async()=>{const address=await connectWallet();liveAccount.current=address;setAccount(address);remember(true);if(await walletChainId()!==network)await switchNetwork(network);await authenticate(address);}).catch(()=>{});};
 useEffect(()=>{let active=true;void(async()=>{try{if(localStorage.getItem(connectionKey)!=='1')return;const accounts=await getProvider().request({method:'eth_accounts'});if(!Array.isArray(accounts)||!accounts[0])return;const address=checkedAddress(accounts[0]);const id=await walletChainId();if(active){setAccount(address);setChainId(id);if(id===421614||id===42161)setNetwork(id);}}catch{/* Explicit connect remains available. */}})();return()=>{active=false;};},[]);
 useEffect(()=>{try{return subscribeWallet(items=>{invalidate();remember(Boolean(items[0]));liveAccount.current=items[0];setAccount(items[0]);},id=>{invalidate();setChainId(id);if(id===421614||id===42161)setNetwork(id);});}catch{return;}},[invalidate]);
 const switchTo=(id:421614|42161)=>{invalidate();void run(async()=>{setNetwork(id);if(account){await switchNetwork(id);setChainId(await walletChainId());}}).catch(()=>{});};
 const selectRole=(next:DemoRole)=>{go("/");void run(async()=>{const revision=epoch.current;const result=await gateway.selectRole(next);if(revision!==epoch.current)return;apply(result);setRole(next);setChoose(false);setIdentity(false);}).catch(()=>{});};
 const disconnect=()=>{invalidate();remember(false);setAccount(undefined);liveAccount.current=undefined;};
 const roleInfo=roles.find(r=>r.id===role);
 const unsupported=network===42161||Boolean(chainId&&chainId!==421614);
 const content=()=>{
  if(terms)return <PublicTerms overview={overview} error={publicError} retry={readPublic}/>;
  if(unsupported)return <section className="dg-narrow"><Heading title="This deployment is unavailable." copy="Arbitrum One has no configured deployment. Switch to Arbitrum Sepolia to continue."/><Button onClick={()=>switchTo(421614)} busy={busy}>Use Arbitrum Sepolia</Button></section>;
  if(!account)return <PublicHome overview={overview} error={publicError} retry={readPublic} connect={connect} busy={busy}/>;
  if(!state)return <section className="dg-narrow dg-welcome"><Heading title={busy?'Checking your profile…':'Verify your wallet.'} copy="Sign a message to securely retrieve your workspace."/><Button busy={busy} onClick={()=>void run(()=>authenticate()).catch(()=>{})}>Sign in to Lockgate</Button></section>;
  if(route.split("?")[0]==="/records")return <section><Heading title="Agreements & history." copy="Your saved activity and transaction references."/><Records receipts={state.receipts} agreements={state.agreements}/></section>;
  if(choose||!role)return <RoleEntry choose={selectRole} busy={busy}/>;
  if((role==='originator'||role==='manager')&&!state.workspace)return <EnquiryForm key={role} role={role} busy={busy} submit={value=>run(()=>gateway.enquire(value))} back={()=>setChoose(true)}/>;
  if((role==='investor'||role==='provider')&&(!state.profile.identity||identity))return <IdentityEntry back={()=>{setIdentity(false);setChoose(true);}} busy={busy} onSelect={id=>void run(async()=>{const revision=epoch.current;const next=await gateway.selectIdentity(id);if(revision===epoch.current){apply(next);setIdentity(false);}}).catch(()=>{})}/>;
  if(!state.deploymentReady)return <section><Heading title="Your workspace is being prepared." copy="Your profile is saved. Financial actions become available after the deployment is ready."/><Button secondary busy={busy} onClick={()=>void run(refresh).catch(()=>{})}>Check readiness</Button></section>;
  const shared={state,gateway,run,busy,refresh};
  if(role==='investor')return <Investor {...shared} onIdentity={()=>setIdentity(true)} onDemo={()=>setDemo(true)}/>;
  if(role==='provider')return <Provider {...shared}/>;
  return <Institution {...shared}/>;
 };
 return <div className="dg-app"><header className="dg-topbar"><button className="dg-brand" onClick={()=>{go("/");if(state)setChoose(true);}} aria-label="Lockgate home"><img src="/mark.svg" width="25" height="28" alt=""/>Lockgate<span>.</span></button><div className="dg-top-actions"><Select value={String(network)} onValueChange={v=>switchTo(Number(v) as 421614|42161)} options={[{value:'421614',label:'Arbitrum Sepolia',icon:<ArbitrumMark size={24} decorative/>},{value:'42161',label:'Arbitrum One',icon:<ArbitrumMark size={24} decorative/>}]} label="Network" disabled={busy}/>{state&&!unsupported&&<Button secondary disabled={busy} onClick={()=>setDemo(true)}>Demo</Button>}{account&&<WalletMenu key={account} account={account} gas={state?.setup.gas} usdg={state?.setup.usdg} busy={busy} onDisconnect={disconnect}/>}</div></header>
 <div className="dg-body">{state&&!choose&&role&&!unsupported&&!terms&&<nav className="dg-workspace-nav" aria-label="Workspace"><div><span className="dg-eyebrow">Your workspace</span><strong>{roleInfo?.title}</strong>{state.profile.identity&&<small>{state.profile.identity.name} · TEST identity</small>}</div><div className="dg-nav-actions"><a className="dg-button dg-secondary" href="#/records">Records</a><Button secondary disabled={busy} onClick={()=>setChoose(true)}>Switch workspace <ArrowUpRight size={14}/></Button><button className="dg-icon-button" disabled={busy} aria-label="Refresh workspace" onClick={()=>void run(refresh).catch(()=>{})}><RefreshCw size={17}/></button></div></nav>}{error&&<Notice error>{error}</Notice>}<main key={`${account||'guest'}:${chainId}:${role||'entry'}`} aria-busy={busy}>{content()}</main></div>
 <footer className="dg-footer"><span>Lockgate · Earlier exits, considered.</span><span className="dg-footer-brands"><ArbitrumMark size={24}/><span>Built on Arbitrum</span><PaxosBrand width={60}/><span>USDG integration</span></span><a href="mailto:gabriel@lockgate.finance">Contact</a></footer>{demo&&state&&!unsupported&&<DemoSheet state={state} gateway={gateway} busy={busy} run={run} refresh={refresh} close={()=>setDemo(false)}/>}</div>;
}
