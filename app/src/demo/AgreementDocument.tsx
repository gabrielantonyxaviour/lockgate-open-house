import { useEffect, useId, useState, type ReactNode } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from './Common';
import './legal-document.css';

export function AgreementDocument({ title, text, version, documentId, digest, identityName, signerName, signed, busy, expiresAt, onSign, signLabel, children }: {
  title: string; text: string; version: string; documentId: string; digest: string;
  identityName: string; signerName?: string; signed: boolean; busy: boolean; expiresAt?: string;
  onSign: (name: string) => void; signLabel: string; children?: ReactNode;
}) {
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [now, setNow] = useState(Date.now());
  const nameId = useId();
  const hintId = useId();
  useEffect(() => {
    if (!expiresAt || signed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, signed]);
  const expiry = expiresAt ? Date.parse(expiresAt) : undefined;
  const expired = expiry !== undefined && (!Number.isFinite(expiry) || now >= expiry);
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const validName = Boolean(identityName && normalize(name) === normalize(identityName));
  return <section className="dg-legal-document">
    <div className="dg-legal-toolbar"><span><FileText size={16}/>Version {version}</span><Button secondary onClick={() => downloadText(documentId, text)}><Download size={15}/>Download agreement</Button></div>
    <article className="dg-legal-paper" tabIndex={0} aria-label={title}>
      {text.split(/\r?\n/).map((line, index) => {
        if (!line.trim()) return <div className="dg-legal-space" key={index} aria-hidden="true"/>;
        if (index === 0) return <h2 key={index}>{line}</h2>;
        if (/^(?:\d+[.)]\s|[A-Z][A-Z\s/&—–-]{5,}$)/.test(line)) return <h3 key={index}>{line}</h3>;
        return <p key={index}>{line}</p>;
      })}
    </article>
    <details className="dg-legal-reference"><summary>Agreement reference</summary><p>{documentId}</p><code>{digest}</code></details>
    <div className="dg-legal-signature">
      <h3>Electronic signature</h3>
      {signed ? <><label className="dg-field" htmlFor={nameId}>Full name<input id={nameId} value={signerName || identityName} readOnly/></label><p className="dg-caption">Wallet signature recorded for this agreement.</p></> : <>
        <label className="dg-field" htmlFor={nameId}>Full name<input id={nameId} autoComplete="name" maxLength={120} value={name}
          onChange={event => { setName(event.target.value); setConsent(false); }} disabled={busy || expired}
          aria-describedby={hintId} aria-invalid={Boolean(name && !validName)}/></label>
        <p id={hintId} className={name && !validName ? 'dg-field-error' : 'dg-caption'}>Enter your verified full name: {identityName}.</p>
        <label className="dg-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!validName || busy || expired}/><span>I have read this exact agreement and agree to its terms. I intend my typed name and wallet signature to sign this agreement.</span></label>
        {expired && <p className="dg-field-error" role="status">This agreement has expired. Go back and request current terms before signing.</p>}
        <div className="dg-actions"><Button disabled={!validName || !consent || expired} busy={busy} onClick={() => onSign(name.normalize('NFKC').trim().replace(/\s+/g, ' '))}>{signLabel}</Button></div>
      </>}
      {children}
    </div>
  </section>;
}

function downloadText(id: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lockgate-${id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
