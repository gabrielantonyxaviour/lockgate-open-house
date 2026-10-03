import {useEffect,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import {formatUnits,type Address} from 'viem';
import {Select} from '../ui/Select';
import {useApp} from '../ui/context';
import {PageHead,Panel,Badge,Empty,Explorer,money,date} from '../ui/primitives';
import {judgeReadiness} from '../chain/readiness';
import {errorMessage,publicClient,addressSchema} from '../chain/client';
import {walletChainId,switchNetwork,subscribeWallet} from '../chain/wallet';
import {CHAIN} from '../chain/config';
interface WalletCheck {checking:boolean;chainId?:number;gas?:bigint;error?:string}
export default function Judge(){
 const {snapshot,account,preview,connect,refresh,loading}=useApp();
 const [selected,setSelected]=useState<Address|undefined>(()=>{const value=new URLSearchParams(location.hash.split('?')[1]??'').get('platform');const parsed=addressSchema.safeParse(value);return parsed.success?parsed.data:undefined;});
 const [wallet,setWallet]=useState<WalletCheck>({checking:false});
 const [version,setVersion]=useState(0);
 const [switching,setSwitching]=useState(false);
 const [networkError,setNetworkError]=useState('');
 useEffect(()=>{
  let current=true;
  setWallet({checking:Boolean(account&&!preview)});
  if(!account||preview)return()=>{current=false;};
  void (async()=>{
   try {
    const chainId=await walletChainId();
    if(chainId!==CHAIN.id){if(current)setWallet({checking:false,chainId});return;}
    try {const gas=await publicClient.getBalance({address:account});if(current)setWallet({checking:false,chainId,gas});}
    catch(error){if(current)setWallet({checking:false,chainId,error:errorMessage(error)});}
   }catch(error){if(current)setWallet({checking:false,error:errorMessage(error)});}
  })();
  return()=>{current=false;};
 },[account,preview,version,snapshot?.blockNumber]);
 useEffect(()=>{
  if(!account||preview)return;
  try{return subscribeWallet(()=>setVersion(v=>v+1),()=>setVersion(v=>v+1));}
  catch{return;}
 },[account,preview]);
 const ready=judgeReadiness(snapshot,account,wallet.chainId,Date.now(),selected);
 const platform=ready.platform;
 const queued=platform?.requests.find(r=>r.status==='Queued'&&r.owner.toLowerCase()===account?.toLowerCase());
 const exitPath=platform?`#/exit/${platform.address}${queued?`?request=${queued.id}`:''}`:'#/platforms';
 const walletSnapshot=ready.checks.find(check=>check.id==='snapshot')?.status==='ready';
 const gasObserved=wallet.gas!==undefined&&wallet.gas>0n;
 const checkAgain=async()=>{await refresh();setVersion(v=>v+1);};
 const switchWallet=async()=>{setSwitching(true);setNetworkError('');try{await switchNetwork();await checkAgain();}catch(error){setNetworkError(errorMessage(error));}finally{setSwitching(false);}};
 return <div className="stack">
  <PageHead eyebrow="OPEN HOUSE WALKTHROUGH" title="One exit. Follow the money." description="Use your own wallet and amounts on Arbitrum Sepolia. Each step uses deployed contract state; historical examples are labelled separately." action={<button className="button secondary" onClick={checkAgain} disabled={loading||wallet.checking}><RefreshCw size={14}/>Refresh readiness</button>}/>
  {preview&&<div className="notice">You are inspecting an illustrative preview. Wallet checks and transactions are disabled. Return to chain data using the application’s preview control.</div>}
  <Panel title="Before you begin" eyebrow="ACTUAL READINESS">
   <div className="stack">
    {snapshot&&snapshot.platforms.length>1&&<div className="field"><span>Walkthrough platform</span><Select label="Walkthrough platform" value={platform?.address??''} onValueChange={value=>setSelected(addressSchema.parse(value))} options={snapshot.platforms.map(p=>({value:p.address,label:`${p.name} · ${p.nextWindow>BigInt(Math.floor(Date.now()/1000))?'Future window':'Window due'}`}))}/></div>}
    {ready.checks.map(check=><div className="row between" key={check.id}><div><strong>{check.label}</strong><p className="text-small muted">{check.detail}</p></div><Badge tone={check.status==='ready'?'good':check.status==='blocked'?'warn':'muted'}>{check.status==='unknown'?'Not verified':check.status==='ready'?'Observed':'Needs attention'}</Badge></div>)}
    <div className="row between"><div><strong>Sepolia ETH for gas</strong><p className="text-small muted">{wallet.checking?'Checking the connected wallet…':wallet.gas!==undefined?`${formatUnits(wallet.gas,18)} ETH observed. Each transaction still requires a gas estimate.`:wallet.error?wallet.error:'Connect on Arbitrum Sepolia to check ETH. Gas has not been verified.'}</p></div><Badge tone={gasObserved?'good':wallet.gas===0n?'warn':'muted'}>{gasObserved?'Balance observed':wallet.gas===0n?'No ETH':'Not verified'}</Badge></div>
   </div>
  </Panel>
  <div className="grid-two">
   <Panel title="1. Connect and check the network"><div className="stack"><p>Connect your browser wallet. These contracts are deployed on Arbitrum Sepolia.</p>{account?<Explorer address={account}/>:<button className="button" onClick={connect} disabled={preview}>Connect wallet</button>}{account&&wallet.chainId!==CHAIN.id&&<button className="button" disabled={preview||switching} onClick={switchWallet}>{switching?'Switching…':'Switch to Arbitrum Sepolia'}</button>}{networkError&&<div className="notice error" role="alert">{networkError}</div>}<p className="text-small muted">No automated USDG faucet or ETH funding service is connected. A positive ETH balance does not guarantee enough gas for every action.</p></div></Panel>
   <Panel title="2. Fund a position"><div className="stack"><p>Deposit an amount of testnet USDG in the deployed platform. The wallet first approves the exact USDG amount if needed, then confirms the deposit.</p>{platform?<dl className="key-values"><div><dt>Platform</dt><dd>{platform.name}</dd></div><div><dt>Your USDG</dt><dd>{walletSnapshot?money(snapshot!.usdgBalance):'Not verified'}</dd></div><div><dt>Available shares</dt><dd>{walletSnapshot?money(platform.holding,18):'Not verified'}</dd></div></dl>:<Empty title="No platform loaded">Refresh chain data before starting.</Empty>}{platform&&<a className="button secondary" href={`#/platform/${platform.address}`}>Open platform and funding form <ArrowRight size={13}/></a>}<p className="text-small muted">{ready.canFund&&gasObserved?'USDG and an ETH balance are present; the wallet must still estimate gas and the contract validates the selected amount.':ready.canFund?'USDG is available, but an ETH balance has not been verified. Review the gas check before signing.':'Funding is not verified as available. Review the readiness checks before signing.'}</p></div></Panel>
   <Panel title="3. Review a quote and exit"><div className="stack"><p>Use your shares or your queued request. Review fee, cash received and minimum received before approving the wallet transaction.</p>{ready.exitPreconditionsMet?<div className="notice">Basic conditions are present. A live quote must still confirm capacity, reserves, limits and pricing.</div>:<div className="notice">Early-exit prerequisites are not currently satisfied. The quote screen shows the actual availability reason.</div>}{platform&&<p className="text-small">Next settlement window: {date(platform.nextWindow)}</p>}{platform&&<a className="button secondary" href={exitPath}>Inspect the live quote <ArrowRight size={13}/></a>}{ready.canProcessWindow&&platform&&<><div className="notice">The window is due. Settlement is permissionless, but may leave the window open if platform cash cannot repay advances. Processing one overdue window may still leave later missed windows due.</div><a className="inline-link" href={`#/platform/${platform.address}`}>Inspect settlement and process the due window</a></>}</div></Panel>
   <Panel title="4. Inspect your receipt"><div className="stack"><p>After an exit confirms, open its receipt from My exits. Inspect principal, fee, due time and the linked transaction evidence.</p>{ready.ownAdvances.length?<div className="stack">{ready.ownAdvances.slice(-3).reverse().map(a=><a className="inline-link" href={`#/advance/${a.id}`} key={String(a.id)}>Your advance #{String(a.id)} · {money(a.principal)} USDG paid</a>)}</div>:<p className="text-small muted">No confirmed advance to this wallet is in the snapshot. A quote alone does not complete this step.</p>}<a className="button secondary" href="#/positions">Open My exits</a></div></Panel>
  </div>
  <Panel title="5. Inspect platform repayment"><div className="stack"><p>The platform repays Lockgate before paying queued investors. Anyone may process an open settlement window; issuer NAV and gate controls, Lockgate capital controls and partner funds require their respective authorized wallets.</p><div className="notice">Your role: {ready.isIssuer?'platform issuer':ready.isOperator?'Lockgate operator':'investor / observer'}. Browsing the walkthrough does not grant issuer, operator or partner permissions.</div><div className="row"><a className="button secondary" href="#/activity">Read actual contract activity</a>{platform&&<a className="inline-link" href={`#/platform/${platform.address}`}>Inspect the repayment waterfall</a>}</div><p className="text-small muted">An advance is cleared only when its remaining obligation is zero. A late advance covered by reserves is recovery, not evidence of an on-time platform repayment.</p></div></Panel>
  {ready.historicalAdvances.length>0&&<Panel title="Historical examples — separate from your walkthrough"><div className="stack"><p>These advances already exist on the shared testnet deployment. Inspecting them does not mean you funded or executed a new exit.</p>{ready.historicalAdvances.slice(-3).reverse().map(a=><div className="row between" key={String(a.id)}><a className="inline-link" href={`#/advance/${a.id}`}>Advance #{String(a.id)} · {money(a.principal)} USDG principal</a><Badge tone={a.remaining===0n?'good':'warn'}>{a.remaining===0n?'Balance cleared':`${money(a.remaining)} USDG outstanding`}</Badge></div>)}</div></Panel>}
 </div>;
}
