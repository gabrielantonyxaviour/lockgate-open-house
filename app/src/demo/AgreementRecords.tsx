import { Check, ChevronDown, Download, FileText } from 'lucide-react';
import { ChainReference, ReferenceText } from './ChainReference';
import { Button } from './Common';
import type { AgreementRecord } from './types';
import './agreement-records.css';

/** Presentation only. The stored text, digest and download remain the signed original. */
export function AgreementRecords({ agreements }: { agreements: AgreementRecord[] }) {
  return <div className="dg-agreement-records">{agreements.map(agreement =>
    <details className="dg-record-document" key={agreement.id} open={agreements.length === 1}>
      <summary className="dg-record-summary">
        <FileText size={19} aria-hidden="true"/>
        <span className="dg-record-summary-title">{agreement.title}<small>Version {agreement.version}{agreement.signedAt ? ` · Signed ${formatDate(agreement.signedAt, false)}` : ` · ${agreement.status}`}</small></span>
        <ChevronDown size={17} className="dg-record-chevron" aria-hidden="true"/>
      </summary>
      <article className="dg-record-paper" aria-label={`${agreement.title} document`}>
        <header className="dg-record-letterhead"><span className="dg-record-wordmark">Lockgate<span>.</span></span><span>Agreement record<br/>Version {agreement.version}</span></header>
        <div className="dg-record-title"><p className="dg-record-kicker">{agreement.signedAt ? 'Signed copy' : 'Recorded document'}</p><h2>{agreement.title}</h2></div>
        <dl className="dg-record-metadata">
          <div><dt>Document reference</dt><dd><ReferenceText text={agreement.id}/></dd></div>
          {agreement.signedAt && <div><dt>Signed on</dt><dd><time dateTime={agreement.signedAt}>{formatDate(agreement.signedAt)}</time></dd></div>}
        </dl>
        <div className="dg-record-body">{agreement.text.split(/\r?\n/).map((line, index) => {
          if (!line.trim()) return <div className="dg-record-paragraph-space" key={index} aria-hidden="true"/>;
          const heading = line.length <= 100 && /^(?:\d+[.)]\s|[A-Z][A-Z\s/&—–-]{5,}$)/.test(line);
          return heading ? <h3 key={index}>{line}</h3> : <p key={index}>{line}</p>;
        })}</div>
        <footer className="dg-record-evidence">
          <div className="dg-record-signature"><span className="dg-record-kicker">Signature record</span>{agreement.signerName && <strong>{agreement.signerName}</strong>}<span>{agreement.signedAt ? <><Check size={14} aria-hidden="true"/>Wallet signature recorded</> : agreement.status}</span></div>
          <div className="dg-record-digest"><span className="dg-record-kicker">Document digest</span><ChainReference value={agreement.digest}/></div>
        </footer>
      </article>
      <div className="dg-record-actions"><p>Original signed text retained with its document digest.</p><Button secondary onClick={() => downloadAgreement(agreement)}><Download size={15}/>Download agreement</Button></div>
    </details>
  )}</div>;
}

function formatDate(value: string, includeTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' as const } : {}), timeZone: 'UTC' }).format(date);
}

function downloadAgreement(agreement: AgreementRecord) {
  const url = URL.createObjectURL(new Blob([agreement.text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lockgate-${agreement.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}-v${agreement.version.replace(/[^a-z0-9_.-]/gi, '-')}.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
