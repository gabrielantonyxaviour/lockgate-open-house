import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import './chain-reference.css';
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
export function ChainReference({value,transaction=false}:{value:string;transaction?:boolean}) {
 const [copied,setCopied]=useState(false);
 const [error,setError]=useState('');
 const address=addressPattern.test(value);
 if(!address&&!hashPattern.test(value))return <>{value}</>;
 const href=address?`https://sepolia.arbiscan.io/address/${value}`:transaction?`https://sepolia.arbiscan.io/tx/${value}`:undefined;
 const short=`${value.slice(0,8)}…${value.slice(-6)}`;
 return <span className="dg-chain-reference"><code>{short}</code>{href?<a href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${address?'address':'transaction'} in explorer`}><ExternalLink size={14}/></a>:<button aria-label="Copy document reference" onClick={()=>void navigator.clipboard.writeText(value).then(()=>{setCopied(true);setError('');}).catch(()=>setError('Copy unavailable.'))}>{copied?<Check size={14}/>:<Copy size={14}/>}</button>}{(copied||error)&&<span className="dg-reference-status" role="status">{error||'Reference copied.'}</span>}</span>;
}
/** Presentation only: canonical documents and clipboard values retain full identifiers. */
export function ReferenceText({text}:{text:string}) {
 return <>{text.split(/(0x[0-9a-f]{64}|0x[0-9a-f]{40})(?![0-9a-f])/gi).map((part,index)=>addressPattern.test(part)||hashPattern.test(part)?<ChainReference key={index} value={part}/>:part)}</>;
}
