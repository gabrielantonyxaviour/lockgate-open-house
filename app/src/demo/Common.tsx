import { ChainReference, ReferenceText } from './ChainReference';
import type { ReactNode } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
export { TransactionHistory as Records } from './TransactionHistory';
export function Heading({eyebrow,title,copy,back}:{eyebrow?:string;title:string;copy?:string;back?:()=>void}) {
 return <header className="dg-heading">{back&&<button className="dg-back" onClick={back}><ArrowLeft size={15}/>Back</button>}{eyebrow&&<span className="dg-eyebrow">{eyebrow}</span>}<h1 tabIndex={-1}>{title}</h1>{copy&&<p>{copy}</p>}</header>;
}
export function Button({children,onClick,busy=false,disabled=false,secondary=false,type='button'}:{children:ReactNode;onClick?:()=>void;busy?:boolean;disabled?:boolean;secondary?:boolean;type?:'button'|'submit'}) {
 return <button type={type} className={`dg-button ${secondary?'dg-secondary':''}`} disabled={busy||disabled} onClick={onClick}>{busy&&<LoaderCircle size={16} className="dg-spin"/>}{children}</button>;
}
export function Notice({children,error=false}:{children:ReactNode;error?:boolean}){return <div className={`dg-notice ${error?'dg-error':''}`} role={error?'alert':'status'}>{children}</div>;}
export function Rows({items}:{items:[string,ReactNode][]}){return <dl className="dg-rows">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='string'?/^(Receipt|Transaction hash)$/.test(label)?<ChainReference value={value} transaction/>:<ReferenceText text={value}/>:value}</dd></div>)}</dl>;}
export const money=(value:string|undefined)=>value===undefined?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(value));
