import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, FileText, House, ListChecks, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { Workspace } from './types';
import './dashboard.css';
export type InstitutionPage='overview'|'actions'|'transactions'|'agreements';
const items=[{id:'overview',label:'Overview',icon:House},{id:'actions',label:'Actions',icon:SlidersHorizontal},{id:'transactions',label:'Transaction history',icon:ListChecks},{id:'agreements',label:'Agreements',icon:FileText}] as const;
export function InstitutionShell({workspace,page,onPage,busy,refresh,children}:{workspace:Workspace;page:InstitutionPage;onPage:(page:InstitutionPage)=>void;busy:boolean;refresh:()=>Promise<void>;children:ReactNode}){
 const mobile=useRef<HTMLDetailsElement>(null);
 const [refreshing,setRefreshing]=useState(false);
 const role=workspace.authorization?.role||(/firm/i.test(workspace.title)?'manager':'originator');
 const roleName=role==='manager'?'Licensed investment firm':'Originating fund / platform';
 const current=items.find(item=>item.id===page)!;
 useEffect(()=>{if(mobile.current)mobile.current.open=false;window.scrollTo({top:0,left:0,behavior:'instant'});},[page]);
 const identity=<><strong>{workspace.organization}</strong><span>{roleName}</span></>;
 const links=(isMobile=false)=><nav aria-label={isMobile?'Mobile institution navigation':'Institution navigation'}>{items.map(({id,label,icon:Icon})=><a key={id} href={`#/institution/${id}`} aria-current={page===id?'page':undefined} aria-disabled={busy||undefined} onClick={event=>{event.preventDefault();if(busy)return;onPage(id);if(mobile.current)mobile.current.open=false;}}><Icon size={17} aria-hidden="true"/><span>{label}</span></a>)}</nav>;
 return <div className="dg-dashboard dg-institution-shell">
  <aside className="dg-dashboard-sidebar"><div className="dg-dashboard-identity dg-institution-identity">{identity}</div>{links()}</aside>
  <div className="dg-dashboard-main">
   <div className="dg-institution-mobile-identity">{identity}</div>
   <details ref={mobile} className="dg-dashboard-mobile" onKeyDown={event=>{if(event.key==='Escape'&&mobile.current?.open){mobile.current.open=false;mobile.current.querySelector('summary')?.focus();}}}>
    <summary aria-label="Institution navigation menu"><span>{current.label}</span><ChevronDown size={16}/></summary>{links(true)}
   </details>
   <div className="dg-dashboard-toolbar"><span>Institution <span aria-hidden="true">/</span><strong>{current.label}</strong></span><button className="dg-icon-button" disabled={busy||refreshing} aria-label={refreshing?'Refreshing account':'Refresh account'} aria-busy={refreshing} onClick={()=>{setRefreshing(true);void refresh().catch(()=>{}).finally(()=>setRefreshing(false));}}><RefreshCw size={16} className={refreshing?'dg-spin':undefined}/></button></div>
   <div className="dg-dashboard-content">{children}</div>
  </div>
 </div>;
}
