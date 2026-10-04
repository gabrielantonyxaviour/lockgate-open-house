import { Check, ChevronDown, FileText } from 'lucide-react';
import { ChainReference, ReferenceText } from './ChainReference';
import { AgreementViewer } from './AgreementViewer';
import type { AgreementRecord } from './types';
import './agreement-records.css';

/** The viewer, digest and download all use the stored original. */
export function AgreementRecords({ agreements }: { agreements: AgreementRecord[] }) {
  return <div className="dg-agreement-records">{agreements.map(agreement =>
    <details className="dg-record-document" key={agreement.id} open={agreements.length === 1}>
      <summary className="dg-record-summary">
        <FileText size={19} aria-hidden="true"/>
        <span className="dg-record-summary-title">{agreement.title}<small>Version {agreement.version}{agreement.signedAt ? ` · Signed ${formatDate(agreement.signedAt, false)}` : ` · ${agreement.status}`}</small></span>
        <ChevronDown size={17} className="dg-record-chevron" aria-hidden="true"/>
      </summary>
      <div className="dg-record-review">
        <article className="dg-record-evidence" aria-label="Agreement record">
          <dl className="dg-record-metadata">
            <div><dt>Document reference</dt><dd><ReferenceText text={agreement.id}/></dd></div>
            {agreement.signedAt && <div><dt>Signed on</dt><dd><time dateTime={agreement.signedAt}>{formatDate(agreement.signedAt)}</time></dd></div>}
          </dl>
          <div className="dg-record-signature"><span className="dg-record-kicker">Signature record</span>{agreement.signerName && <strong>{agreement.signerName}</strong>}<span>{agreement.signedAt ? <><Check size={14} aria-hidden="true"/>Wallet signature recorded</> : agreement.status}</span></div>
          <div className="dg-record-digest"><span className="dg-record-kicker">Document digest</span><ChainReference value={agreement.digest}/></div>
          <p className="dg-caption">Original document text retained with its digest.</p>
        </article>
        <div className="dg-record-paper"><AgreementViewer title={agreement.title} text={agreement.text} version={agreement.version} documentId={agreement.id} digest={agreement.digest} signed={Boolean(agreement.signedAt)}/></div>
      </div>
    </details>
  )}</div>;
}

function formatDate(value: string, includeTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' as const } : {}), timeZone: 'UTC' }).format(date);
}
