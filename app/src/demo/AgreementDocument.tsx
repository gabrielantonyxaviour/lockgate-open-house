import { useEffect, useId, useState, type ReactNode } from 'react';
import { AgreementViewer } from './AgreementViewer';
import { Button } from './Common';
import './legal-document.css';

export function AgreementDocument({ title, text, version, documentId, digest, identityName, signerName, signed, busy, expiresAt, onSign, signLabel, children, summary, onDefer }: {
  title: string; text: string; version: string; documentId: string; digest: string;
  identityName: string; signerName?: string; signed: boolean; busy: boolean; expiresAt?: string;
  onSign: (name: string) => void; signLabel: string; children?: ReactNode; summary?: ReactNode; onDefer?: () => void;
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
  return <section className="dg-agreement-review">
    <div className="dg-agreement-controls">{summary}
    <div className="dg-legal-signature dg-panel">
      <h3>{signed ? 'Electronic signature' : 'Agree when you’re ready'}</h3>{!signed && <p className="dg-caption">Read the document, download a copy, or save it to review later. Saving a draft does not sign it.</p>}
      {signed ? <><label className="dg-field" htmlFor={nameId}>Full name<input id={nameId} value={signerName || identityName} readOnly/></label><p className="dg-caption">Wallet signature recorded for this agreement.</p></> : <>
        <label className="dg-field" htmlFor={nameId}>Full name<input id={nameId} autoComplete="name" maxLength={120} value={name}
          onChange={event => { setName(event.target.value); setConsent(false); }} disabled={busy || expired}
          aria-describedby={hintId} aria-invalid={Boolean(name && !validName)}/></label>
        <p id={hintId} className={name && !validName ? 'dg-field-error' : 'dg-caption'}>Enter your verified full name: {identityName}.</p>
        <label className="dg-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!validName || busy || expired}/><span>I have read this exact agreement and agree to its terms. I intend my typed name and wallet signature to sign this agreement.</span></label>
        {expired && <p className="dg-field-error" role="status">This agreement has expired. Go back and request current terms before signing.</p>}
        <div className="dg-actions"><Button disabled={!validName || !consent || expired} busy={busy} onClick={() => onSign(name.normalize('NFKC').trim().replace(/\s+/g, ' '))}>{signLabel}</Button></div>
      </>}
      {!signed && onDefer && <div className="dg-actions"><Button secondary disabled={busy || expired} onClick={onDefer}>Save & agree later</Button></div>}
      {children}
    </div></div>
    <AgreementViewer title={title} text={text} version={version} documentId={documentId} digest={digest} signed={signed}/>
  </section>;
}
