import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { RefreshCw, Wallet } from 'lucide-react';
import { checkedAddress, errorMessage } from '../chain/client';
import { connectWallet, getProvider, subscribeWallet, switchNetwork, walletChainId } from '../chain/wallet';
import { ArbitrumMark } from '../ui/Brand';
import { Select } from '../ui/Select';
import { useInputModality } from '../ui/input-modality';
import { Button, Heading, Notice, Records } from './Common';
import { EnquiryForm, IdentityEntry, RoleEntry } from './Entry';
import { DemoSheet } from './DemoSheet';
import { WalletMenu } from './WalletMenu';
import { OnboardingProgress, type OnboardingPhase } from './OnboardingProgress';
import { Dashboard } from './Dashboard';
import { AppFooter } from './AppFooter';
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
 const [state,setState]=useState<DemoState>();
 const [busy,setBusy]=useState(false);
 const [refreshing,setRefreshing]=useState(false);
 const [error,setError]=useState('');
 const [role,setRole]=useState<DemoRole>();
 const [choose,setChoose]=useState(false);
 const [identity,setIdentity]=useState(false);
 const [onboarding,setOnboarding]=useState<OnboardingPhase>();
 const [rolePending,setRolePending]=useState(false);
 const [roleFailed,setRoleFailed]=useState(false);
 const [demo,setDemo]=useState(false);
 const epoch=useRef(0);
 const operation=useRef(false);
 const liveAccount=useRef<Address|undefined>(undefined);
 liveAccount.current=account;
 const invalidate=useCallback(()=>{epoch.current++;setState(undefined);setRole(undefined);setOnboarding(undefined);setRolePending(false);setRoleFailed(false);setIdentity(false);setDemo(false);setChoose(false);setError('');},[]);
 const apply=useCallback((next:DemoState)=>{setState(next);setRole(next.profile.activeRole||next.profile.roles[0]);},[]);
 const run=useCallback(async<T,>(task:()=>Promise<T>):Promise<T>=>{
  if(operation.current)throw new Error('A wallet operation is already in progress.');
  operation.current=true;const revision=epoch.current;setBusy(true);setError('');
  try{return await task();}catch(e){if(revision===epoch.current)setError(errorMessage(e));throw e;}finally{operation.current=false;setBusy(false);}
 },[]);
 const authenticate=async(address=account)=>{if(!address)return;const revision=epoch.current;const current=await walletChainId();setChainId(current);const next=await gateway.authenticate(address,current);if(revision===epoch.current&&liveAccount.current?.toLowerCase()===address.toLowerCase()){apply(next);if(next.profile.activeRole&&(next.profile.identity||next.workspace))go('/overview');}};
 const refresh=useCallback(async()=>{if(!account)return;const revision=epoch.current;setRefreshing(true);try{const next=await gateway.refresh(account,chainId||0);if(revision===epoch.current)apply(next);}finally{setRefreshing(false);}},[account,chainId,gateway,apply]);
 const connect=()=>{invalidate();void run(async()=>{const address=await connectWallet();liveAccount.current=address;setAccount(address);if(await walletChainId()!==421614)await switchNetwork(421614);await authenticate(address);remember(true);}).catch(()=>{remember(false);setAccount(undefined);liveAccount.current=undefined;});};
 useEffect(()=>{let active=true;void(async()=>{try{if(localStorage.getItem(connectionKey)!=='1')return;const accounts=await getProvider().request({method:'eth_accounts'});if(!Array.isArray(accounts)||!accounts[0])return;const address=checkedAddress(accounts[0]);const id=await walletChainId();if(active){setAccount(address);setChainId(id);}}catch{/* Explicit connect remains available. */}})();return()=>{active=false;};},[]);
 useEffect(()=>{try{return subscribeWallet(items=>{invalidate();remember(Boolean(items[0]));liveAccount.current=items[0];setAccount(items[0]);},id=>{invalidate();setChainId(id);});}catch{return;}},[invalidate]);
 const switchTo=(id:number)=>{if(id!==421614)return;invalidate();void run(async()=>{if(account){await switchNetwork(id);setChainId(await walletChainId());}}).catch(()=>{});};
 const selectRole=(next:DemoRole,intent:'create'|'switch'='create',recover=false)=>{
  if(operation.current)return;
  setIdentity(false);setRoleFailed(false);setChoose(false);setError('');
  if(next==='originator'||next==='manager'){setRole(next);setOnboarding(undefined);go('/enquiry');return;}
  const revision=epoch.current;
  setRole(next);go('/');setRolePending(true);setOnboarding(state?.profile.identity?'checking':'identity');
  void run(async()=>{try{const current=recover&&account?await gateway.refresh(account,chainId||0):undefined;if(revision!==epoch.current)return;const result=current?.profile.roles.includes(next)?current.profile.activeRole===next?current:await gateway.selectRole(next,'switch'):await gateway.selectRole(next,intent);if(revision!==epoch.current)return;apply(result);if(result.profile.identity){setOnboarding(undefined);go('/overview');}}catch(e){if(revision===epoch.current){if(intent==='switch'&&state){apply(state);setOnboarding(undefined);}else setRoleFailed(true);}throw e;}finally{if(revision===epoch.current)setRolePending(false);}}).catch(()=>{});
 };
 const addProfile=()=>{if(operation.current)return;setIdentity(false);setOnboarding(undefined);setError('');setChoose(true);go('/profiles/new');};
 const returnToDashboard=()=>{if(operation.current||!state)return;apply(state);setChoose(false);setRoleFailed(false);setIdentity(false);setOnboarding(undefined);setError('');go('/overview');};
 const bindIdentity=(id:string)=>{if(operation.current)return;setOnboarding('binding');void run(async()=>{const revision=epoch.current;let bound=false;try{const next=await gateway.selectIdentity(id,()=>{bound=true;if(revision===epoch.current)setOnboarding('checking');});if(revision===epoch.current){apply(next);setIdentity(false);setOnboarding(!next.profile.identity?'identity':next.positionStatus==='unavailable'&&next.profile.activeRole==='investor'?'retry':undefined);if(next.profile.identity&&next.positionStatus!=='unavailable')go('/overview');}}catch(e){if(revision===epoch.current)setOnboarding(bound?'retry':'identity');throw e;}}).catch(()=>{});};
 const backToPaths=()=>{if(operation.current)return;setIdentity(false);setOnboarding(undefined);setChoose(true);};
 const disconnect=()=>{invalidate();remember(false);setAccount(undefined);liveAccount.current=undefined;};
 const roleInfo=roles.find(r=>r.id===role);
 const retailRole=role==='investor'||role==='provider'?role:undefined;
 const onboardingVisible=Boolean(retailRole&&!choose&&(onboarding||identity||!state?.profile.identity));
 const unsupported=Boolean(account&&chainId&&chainId!==421614);
 const dashboardVisible=Boolean(state?.profile.identity&&state.deploymentReady&&retailRole&&!choose&&!onboardingVisible&&!unsupported&&!terms);
 const draftParams=new URLSearchParams(route.split('?')[1]||'');
 const draftId=draftParams.get('draft')||undefined;
 const renewDraft=draftParams.get('renew')==='1';
 const positionId=new URLSearchParams(route.split('?')[1]||'').get('position')||undefined;
 const content=()=>{
  if(terms)return <PublicTerms overview={overview} error={publicError} retry={readPublic}/>;
  if(unsupported)return <section className="dg-narrow"><Heading title="This deployment is unavailable." copy="Arbitrum One has no configured deployment. Switch to Arbitrum Sepolia to continue."/><Button onClick={()=>switchTo(421614)} busy={busy}>Use Arbitrum Sepolia</Button></section>;
  if(!account)return <PublicHome overview={overview} error={publicError} retry={readPublic} connect={connect} busy={busy}/>;
  if(!state)return <section className="dg-narrow dg-welcome"><Heading title={busy?'Checking your profile…':'Verify your wallet.'} copy="Sign a message to securely retrieve your account."/></section>;
  if(!onboardingVisible&&route.split("?")[0]==="/records")return <section><Heading title="Transaction History" copy="Your saved activity and transaction references."/><Records receipts={state.receipts}/></section>;
  if(choose||!role)return <RoleEntry choose={selectRole} busy={busy} existingRoles={state.profile.roles} back={state.profile.roles.length?returnToDashboard:undefined}/>;
  if((role==='originator'||role==='manager')&&!state.workspace)return <EnquiryForm key={role} role={role} busy={busy} submit={value=>run(()=>gateway.enquire(value))} back={addProfile}/>;
  if(retailRole&&onboarding==='retry')return <section className="dg-narrow"><Heading title={`Couldn’t check your ${retailRole==='investor'?'positions':'vehicles'}.`} copy="Your identity is linked. Retry your account check."/><Button busy={busy} onClick={()=>void run(async()=>{const revision=epoch.current;setOnboarding('checking');try{await refresh();if(revision===epoch.current){setOnboarding(undefined);setIdentity(false);}}catch(e){if(revision===epoch.current)setOnboarding('retry');throw e;}}).catch(()=>{})}>Retry account check</Button></section>;
  if(roleFailed)return <section className="dg-narrow"><Heading title="Account setup needs another try." back={backToPaths}/><Button onClick={()=>role&&selectRole(role,'create',true)} busy={busy}>Retry account setup</Button></section>;
  if(retailRole&&(rolePending||!state.profile.identity||identity||onboarding==='checking'))return onboarding==='checking'?<section className="dg-narrow"><Heading title={`Checking your ${retailRole==='investor'?'positions':'vehicles'}…`} copy="Your identity is linked. Retrieving your account details."/></section>:<IdentityEntry error={error} busy={busy} preparing={rolePending} onSelect={bindIdentity}/>;
  if(!state.deploymentReady)return <section><Heading title="Your account is being prepared." copy="Your profile is saved. Financial actions become available after the deployment is ready."/><Button secondary busy={busy} onClick={()=>void run(refresh).catch(()=>{})}>Check readiness</Button></section>;
  const shared={state,gateway,run,busy,refresh};
  if(role==='investor')return <Investor key={draftId?`${draftId}:${renewDraft}`:positionId||'positions'} {...shared} draftId={draftId} renewDraft={renewDraft} initialPositionId={positionId} showHistory={false} onIdentity={()=>{setIdentity(true);setOnboarding('identity');}} onDemo={()=>setDemo(true)}/>;
  if(role==='provider')return <Provider key={draftId?`${draftId}:${renewDraft}`:'vehicles'} {...shared} draftId={draftId} renewDraft={renewDraft}/>;
  return <Institution {...shared}/>;
 };
 return <div className="dg-app"><header className="dg-topbar"><button className="dg-brand" onClick={()=>{go("/");if(state&&!state.profile.identity)setChoose(true);}} aria-label="Lockgate home"><img src="/mark.svg" width="25" height="28" alt=""/>Lockgate<span>.</span></button><div className="dg-top-actions">{account&&state?<Select className="dg-network-select" value={chainId===42161?'42161':'421614'} onValueChange={v=>switchTo(Number(v))} options={[{value:'421614',label:'Arbitrum Sepolia',icon:<ArbitrumMark size={20} decorative/>},{value:'42161',label:'Arbitrum One · Soon',disabled:true,icon:<ArbitrumMark size={20} decorative/>}]} label="Network" disabled={busy}/>:<Button onClick={account?()=>void run(()=>authenticate()).catch(()=>{}):connect} busy={busy}><Wallet size={17}/>{busy?'Connecting wallet…':'Connect Wallet'}</Button>}{state&&!unsupported&&<Button secondary disabled={busy} onClick={()=>setDemo(true)}>Demo</Button>}{account&&state&&<WalletMenu key={account} account={account} gas={state?.setup.gas} usdg={state?.setup.usdg} busy={busy} onDisconnect={disconnect}/>}</div></header>
 <div className="dg-body">{onboardingVisible&&retailRole&&!unsupported&&!terms&&<OnboardingProgress role={retailRole} phase={onboarding||'identity'} preparing={rolePending} unavailable={retailRole==='investor'&&state?.positionStatus==='unavailable'}/>}{state&&!choose&&role&&!dashboardVisible&&!onboardingVisible&&!unsupported&&!terms&&<nav className="dg-workspace-nav" aria-label="Workspace"><div><span className="dg-eyebrow">Account</span><strong>{roleInfo?.title}</strong>{state.profile.identity&&<small>{state.profile.identity.name}</small>}</div><div className="dg-nav-actions"><button className="dg-icon-button" disabled={busy} aria-label={refreshing?"Refreshing account":"Refresh account"} aria-busy={refreshing} onClick={()=>void run(refresh).catch(()=>{})}><RefreshCw size={17} className={refreshing?'dg-spin':undefined}/></button></div></nav>}{error&&<Notice error>{error}</Notice>}<main key={`${account||'guest'}:${chainId}:${role||'entry'}`} aria-busy={busy}>{dashboardVisible&&state&&retailRole?<Dashboard state={state} role={retailRole} account={account} busy={busy} refreshing={refreshing} switchProfile={next=>selectRole(next,'switch')} addProfile={addProfile} refresh={()=>void run(refresh).catch(()=>{})}>{content()}</Dashboard>:content()}</main></div>
 <AppFooter/>{demo&&state&&!unsupported&&<DemoSheet state={state} gateway={gateway} busy={busy} run={run} refresh={refresh} close={()=>setDemo(false)}/>}</div>;
}
