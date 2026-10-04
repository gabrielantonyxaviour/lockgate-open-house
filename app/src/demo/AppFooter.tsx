import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Mail, X } from 'lucide-react';
import { ArbitrumMark, PaxosBrand } from '../ui/Brand';
import './footer.css';

const SUPPORT_EMAIL = 'gabriel@lockgate.finance';

export function AppFooter() {
 const [open, setOpen] = useState(false);
 const [copyState, setCopyState] = useState<'idle'|'copied'|'failed'>('idle');
 const root = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const emailLink = useRef<HTMLAnchorElement>(null);
 const panelId = useId();
 const close = () => { setOpen(false); trigger.current?.focus(); };
 useEffect(() => {
  if (!open) return;
  emailLink.current?.focus();
  const onPointer = (event: PointerEvent) => {
   if (!root.current?.contains(event.target as Node)) setOpen(false);
  };
  const onKey = (event: KeyboardEvent) => {
   if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  };
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
  return () => {
   document.removeEventListener('pointerdown', onPointer);
   document.removeEventListener('keydown', onKey);
  };
 }, [open]);
 const copyEmail = async () => {
  try { await navigator.clipboard.writeText(SUPPORT_EMAIL); setCopyState('copied'); }
  catch { setCopyState('failed'); }
 };
 return <footer className="dg-app-footer">
  <div className="dg-app-footer-inner">
   <span className="dg-footer-signoff">Lockgate <span aria-hidden="true">·</span> Earlier exits, considered.</span>
   <div className="dg-footer-partners" aria-label="Built on Arbitrum and Paxos">
    <span>Built on</span>
    <span className="dg-footer-partner"><ArbitrumMark size={24} decorative/><span>Arbitrum</span></span>
    <span className="dg-footer-partner"><PaxosBrand width={66}/></span>
   </div>
   <div className="dg-footer-support" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
   }}>
    <button ref={trigger} type="button" className="dg-footer-contact" aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog" onClick={() => { setCopyState('idle'); setOpen(!open); }}><Mail size={15} aria-hidden="true"/>Contact</button>
    {open && <section id={panelId} className="dg-footer-contact-panel" role="dialog" aria-label="Contact Lockgate">
     <div className="dg-footer-contact-heading"><strong>Contact Lockgate</strong><button type="button" className="dg-footer-close" onClick={close} aria-label="Close contact"><X size={16}/></button></div>
     <p>Questions or need a hand? Email us.</p>
     <span className="dg-footer-email">{SUPPORT_EMAIL}</span>
     <div className="dg-footer-contact-actions">
      <a ref={emailLink} href={`mailto:${SUPPORT_EMAIL}`}><Mail size={15} aria-hidden="true"/>Email us<ArrowUpRight size={14} aria-hidden="true"/></a>
      <button type="button" onClick={() => void copyEmail()}>{copyState==='copied'?<Check size={15} aria-hidden="true"/>:<Copy size={15} aria-hidden="true"/>}{copyState==='copied'?'Copied':'Copy email'}</button>
     </div>
     {copyState==='copied' && <p role="status" className="dg-footer-copy-result">Email address copied.</p>}
     {copyState==='failed' && <p role="alert" className="dg-footer-copy-result">Couldn’t copy automatically. Select the email address above to copy it.</p>}
    </section>}
   </div>
  </div>
 </footer>;
}
