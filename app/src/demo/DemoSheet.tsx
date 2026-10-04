import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { errorMessage } from '../chain/client';
import { useDialog } from '../ui/dialog';
import { Button, Notice, Rows, money } from './Common';
import { ChainReference } from './ChainReference';
import type { DemoGateway, DemoState, Receipt } from './types';
import './demo-sheet.css';

type Action = 'mint' | 'check';
type Feedback = { title:string; detail:string; error?:boolean; confirmed?:boolean; hash?:Receipt['hash'] };
type Props = { state:DemoState; gateway:DemoGateway; busy:boolean; run:<T>(task:()=>Promise<T>)=>Promise<T>; refresh:()=>Promise<void>; close:()=>void };

export function DemoSheet({state,gateway,busy,run,refresh,close}:Props) {
 const ref=useRef<HTMLElement>(null);
 const inFlight=useRef(false);
 const [action,setAction]=useState<Action>();
 const [feedback,setFeedback]=useState<Feedback>();
 const [minted,setMinted]=useState(false);
 const [pendingReceipt,setPendingReceipt]=useState<Receipt>();
 useEffect(()=>{
  if(!pendingReceipt||action)return;
  const recorded=state.receipts.find(item=>item.hash===pendingReceipt.hash&&item.id===pendingReceipt.id);
  if(recorded?.status==='confirmed'){
   setMinted(true);setPendingReceipt(undefined);
   setFeedback({title:'Test position minted',detail:'Your positions are up to date. Close this panel to explore an exit.',confirmed:true,hash:recorded.hash});
  }else if(recorded?.status==='reverted'){
   setPendingReceipt(undefined);setFeedback({title:'Mint transaction reverted',detail:'No position was created. You can try again.',error:true,hash:recorded.hash});
  }
 },[state.receipts,pendingReceipt,action]);
 const locked=busy||Boolean(action);
 useDialog(ref,close,locked);
 const execute=async(next:Action)=>{
  if(locked||inFlight.current)return;
  inFlight.current=true;
  setAction(next);
  setFeedback({title:next==='mint'?'Minting your test position…':'Checking your setup…',detail:next==='mint'?'Waiting for confirmation on Arbitrum Sepolia. Your positions will update automatically.':'Refreshing your balances and supported positions.'});
  let receipt:Receipt|undefined;
  let refreshFailed=false;
  try {
   await run(async()=>{
    if(next==='mint'){
     receipt=await gateway.mintPosition();
     if(receipt.status==='reverted')throw new Error('The mint transaction reverted. No position was created.');
     const confirmed=receipt.status==='confirmed';
     setMinted(confirmed);
     if(!confirmed)setPendingReceipt(receipt);
     setFeedback({title:confirmed?'Position minted. Updating your account…':'Transaction submitted. Checking your account…',detail:confirmed?'The transaction is confirmed on Arbitrum Sepolia.':'Confirmation is still pending. Do not submit another mint.',confirmed,hash:receipt.hash});
    }
    try {await refresh();} catch(error) {
     if(receipt?.status!=='confirmed')throw error;
     refreshFailed=true;
    }
   });
   setFeedback(receipt ? {
    title:receipt.status==='confirmed'?'Test position minted':'Mint confirmation pending',
    detail:refreshFailed?'The transaction is confirmed, but your account could not refresh. Use Check setup to load the new position.':receipt.status==='confirmed'?'Your positions are up to date. Close this panel to explore an exit.':'Use Check setup to refresh the transaction status before trying again.',
    confirmed:receipt.status==='confirmed',hash:receipt.hash,
   } : pendingReceipt ? {title:'Mint confirmation pending',detail:'The transaction is still being checked. Do not submit another mint.',hash:pendingReceipt.hash} : {title:'Setup is up to date',detail:'Your balances and supported positions have been refreshed.',confirmed:true});
  } catch(error) {
   setFeedback(receipt?.status==='confirmed' ? {
    title:'Test position minted',detail:'The transaction is confirmed, but your account could not refresh. Use Check setup to load the new position.',confirmed:true,hash:receipt.hash,
   } : {title:next==='mint'?'Couldn’t confirm the mint':'Couldn’t refresh setup',detail:errorMessage(error),error:true,hash:receipt?.hash});
  } finally {setAction(undefined);inFlight.current=false;}
 };
 return <div className="dg-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!locked)close();}}>
  <section ref={ref} className="dg-sheet" role="dialog" aria-modal="true" aria-labelledby="demo-title" tabIndex={-1}>
   <div className="dg-card-top"><span className="dg-badge">{state.environment||'TEST setup · chain 421614'}</span><button className="dg-icon-button" aria-label="Close Demo" disabled={locked} onClick={close}><X size={20}/></button></div>
   <h2 id="demo-title">Demo setup</h2><p>Prepare this wallet with supported TEST assets.</p>
   <Rows items={[["Test gas",`${state.setup.gas} ETH`],["Test USDG",`${money(state.setup.usdg)} USDG`]]}/>
   {state.setup.message&&<Notice>{state.setup.message}</Notice>}
   {state.setup.canGetGas!==undefined&&<div className="dg-setup-item"><h3>Get test gas</h3><p>Open the Arbitrum Sepolia faucet to request test ETH.</p><a className="dg-button dg-secondary" href="https://www.alchemy.com/faucets/arbitrum-sepolia" target="_blank" rel="noopener noreferrer">Get test gas</a></div>}
   <div className="dg-setup-item"><h3>Get test USDG</h3><p>Open the Paxos faucet and select USDG on Arbitrum Sepolia.</p><a className="dg-button dg-secondary" href="https://faucet.paxos.com/" target="_blank" rel="noopener noreferrer">Get test USDG</a></div>
   <div className="dg-setup-item"><h3>Mint test position</h3><p>{state.setup.mintDescription||'Complete TEST identity verification to check supported issuance.'}</p>
    <Button disabled={locked||minted||Boolean(pendingReceipt)||!state.setup.canMint||!state.setup.mintDescription} busy={action==='mint'} onClick={()=>void execute('mint')}>{action==='mint'?'Minting test position…':minted?'Position minted':'Mint test position'}</Button>
    {feedback&&<div className={`dg-setup-feedback${feedback.error?' dg-error':''}`} role={feedback.error?'alert':'status'} aria-live="polite" aria-atomic="true">
     {action?<LoaderCircle size={18} className="dg-spin" aria-hidden="true"/>:feedback.confirmed?<CheckCircle2 size={18} aria-hidden="true"/>:null}
     <div><strong>{feedback.title}</strong><p>{feedback.detail}</p>{feedback.hash&&<ChainReference value={feedback.hash} transaction/>}</div>
    </div>}
   </div>
   <div className="dg-actions"><Button secondary disabled={locked} busy={action==='check'} onClick={()=>void execute('check')}>{action==='check'?'Checking setup…':'Check setup'}</Button></div>
   <p className="dg-caption">Submitted transactions stay in your history. Closing this sheet does not cancel them.</p>
  </section>
 </div>;
}
