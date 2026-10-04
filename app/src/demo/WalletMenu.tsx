import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Address } from 'viem';
import { Check, ChevronDown, Copy, LogOut, Wallet } from 'lucide-react';
import { money } from './Common';

export function WalletMenu({account,gas,usdg,busy,onDisconnect}:{
 account:Address;gas?:string;usdg?:string;busy:boolean;onDisconnect:()=>void;
}) {
 const [open,setOpen]=useState(false);
 const [copied,setCopied]=useState(false);
 const [copyError,setCopyError]=useState('');
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const panel=useRef<HTMLDivElement>(null);
 const id=useId();
 const short=`${account.slice(0,6)}…${account.slice(-4)}`;
 const gasLabel=gas===undefined?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(Number(gas));
 const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape'){event.preventDefault();close(true);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();
  const items=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);
  const current=items.indexOf(document.activeElement as HTMLButtonElement);
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
  items[next]?.focus();
 };
 const copy=async()=>{try{await navigator.clipboard.writeText(account);setCopied(true);setCopyError('');}catch{setCopyError('Copy unavailable. Select the address below.');}};
 return <div className="dg-wallet-menu" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}>
  <button ref={trigger} className="dg-wallet-trigger" disabled={busy} aria-label={`Wallet ${short}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{setOpen(!open);setCopied(false);setCopyError('');}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);}}}>
   <Wallet size={16}/><span><strong>{short}</strong><small>{money(usdg)} USDG <span>·</span> {gasLabel} ETH</small></span><ChevronDown size={14}/>
  </button>
  {open&&<div ref={panel} id={id} className="dg-wallet-popover" role="dialog" aria-label="Wallet actions" onKeyDown={keys}>
   <div className="dg-wallet-detail" role="presentation"><span className="dg-eyebrow">Connected wallet</span><code>{account}</code><dl><div><dt>USDG</dt><dd>{money(usdg)}</dd></div><div><dt>ETH</dt><dd>{gasLabel}</dd></div></dl></div>
   <button className="dg-wallet-item" onClick={()=>void copy()}>{copied?<Check size={16}/>:<Copy size={16}/>}Copy address</button>
   <button className="dg-wallet-item" disabled={busy} onClick={()=>{close();onDisconnect();}}><LogOut size={16}/>Disconnect wallet</button>
   <span className="dg-wallet-copy-status" role="status">{copied?'Address copied.':copyError}</span>
  </div>}
 </div>;
}
