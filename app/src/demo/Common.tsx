import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink, LoaderCircle } from 'lucide-react';
import { AgreementRecords } from './AgreementRecords';
import type { AgreementRecord, Receipt } from './types';
export function Heading({eyebrow,title,copy,back}:{eyebrow?:string;title:string;copy?:string;back?:()=>void}) {
 return <header className="dg-heading">{back&&<button className="dg-back" onClick={back}><ArrowLeft size={15}/>Back</button>}{eyebrow&&<span className="dg-eyebrow">{eyebrow}</span>}<h1 tabIndex={-1}>{title}</h1>{copy&&<p>{copy}</p>}</header>;
}
export function Button({children,onClick,busy=false,disabled=false,secondary=false,type='button'}:{children:ReactNode;onClick?:()=>void;busy?:boolean;disabled?:boolean;secondary?:boolean;type?:'button'|'submit'}) {
 return <button type={type} className={`dg-button ${secondary?'dg-secondary':''}`} disabled={busy||disabled} onClick={onClick}>{busy&&<LoaderCircle size={16} className="dg-spin"/>}{children}</button>;
}
export function Notice({children,error=false}:{children:ReactNode;error?:boolean}){return <div className={`dg-notice ${error?'dg-error':''}`} role={error?'alert':'status'}>{children}</div>;}
export function Rows({items}:{items:[string,ReactNode][]}){return <dl className="dg-rows">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
export const money=(value:string|undefined)=>value===undefined?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(value));
export function Records({receipts,agreements=[]}:{receipts:Receipt[];agreements?:AgreementRecord[]}) {
 return <section className="dg-panel"><h2>Agreements & history</h2><AgreementRecords agreements={agreements}/>{receipts.length===0?<p className="dg-empty">Your confirmed activity and submitted transaction references will appear here.</p>:<div className="dg-records">{receipts.map(r=><article key={r.id}><div><strong>{r.title}</strong><p>{r.detail||r.createdAt}</p>{r.amount&&<span>{receiptAmount(r.amount)}</span>}</div><div className="dg-record-end"><span className={`dg-badge ${r.status==='confirmed'?'':'dg-muted-badge'}`}>{r.status}</span>{r.explorerUrl&&<a href={r.explorerUrl} target="_blank" rel="noreferrer">Transaction <ExternalLink size={12}/></a>}{r.hash&&!r.explorerUrl&&<code title={r.hash}>{r.hash.slice(0,10)}…{r.hash.slice(-6)}</code>}</div></article>)}</div>}</section>;
}

function receiptAmount(value:string){
 const match=/^(-?)(\d+)(?:\.(\d+))?(?:\s+(ETH|USDG))?$/.exec(value.trim());
 if(!match)return value;
 const [,sign,whole,fraction,unit]=match;
 const integer=whole.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
 const decimal=fraction?.replace(/0+$/,'');
 return `${sign}${integer}${decimal?`.${decimal}`:''} ${unit||'USDG'}`;
}
