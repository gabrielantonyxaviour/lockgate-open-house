import { Download, FileText } from 'lucide-react';
import { Button } from './Common';
import type { AgreementRecord } from './types';
export function AgreementRecords({agreements}:{agreements:AgreementRecord[]}) {
 return <div className="dg-agreement-records">{agreements.map(agreement=><details key={agreement.id}>
  <summary><FileText size={16}/><span>{agreement.title}<small>Version {agreement.version} · {agreement.status}</small></span></summary>
  <pre>{agreement.text}</pre><dl className="dg-rows"><div><dt>Agreement</dt><dd>{agreement.id}</dd></div>{agreement.signedAt&&<div><dt>Signed</dt><dd>{agreement.signedAt}</dd></div>}<div><dt>Digest</dt><dd><code>{agreement.digest}</code></dd></div></dl>
  <Button secondary onClick={()=>downloadAgreement(agreement)}><Download size={15}/>Download agreement</Button>
 </details>)}</div>;
}
function downloadAgreement(agreement:AgreementRecord){
 const url=URL.createObjectURL(new Blob([agreement.text],{type:'text/plain;charset=utf-8'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=`lockgate-${agreement.id.replace(/[^a-z0-9_-]/gi,'-').slice(0,80)}-v${agreement.version.replace(/[^a-z0-9_.-]/gi,'-')}.txt`;
 anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
