import { useState } from 'react';
import { FileText } from 'lucide-react';
import { go } from '../ui/router';
import { AgreementViewer } from './AgreementViewer';
import { Button, money } from './Common';
import type { DraftDocument } from './types';

export function DraftDocuments({ drafts, busy }: { drafts: DraftDocument[]; busy: boolean }) {
  const [preview, setPreview] = useState<string>();
  if (!drafts.length) return null;
  return <section className="dg-draft-list" aria-label="Saved agreement drafts"><h2>Saved for later</h2>{drafts.map(draft => {
    const expired = !Number.isFinite(Date.parse(draft.expiresAt)) || Date.parse(draft.expiresAt) <= Date.now();
    return <article key={draft.id} className="dg-panel dg-draft-card">
      <span className="dg-badge"><FileText size={12}/>Unsigned draft{expired ? ' · Terms expired' : ''}</span><h3>{draft.title}</h3>
      <p>{draft.kind === 'exit' ? 'Exit agreement' : 'Capital subscription'} · {money(draft.amount)} {draft.kind === 'exit' ? 'units' : 'USDG'}</p>
      <p>{expired ? 'Your original document is preserved. Review newly generated terms before agreeing.' : `Saved without a signature. Terms expire ${new Date(draft.expiresAt).toLocaleString()}.`}</p>
      <div className="dg-actions"><Button disabled={busy} onClick={() => go(`/${draft.kind === 'exit' ? 'positions' : 'vehicles'}?draft=${encodeURIComponent(draft.id)}${expired ? '&renew=1' : ''}`)}>{expired ? 'Review current terms' : 'Resume review'}</Button><Button secondary onClick={() => setPreview(preview === draft.id ? undefined : draft.id)}>{preview === draft.id ? 'Close document' : 'View / export saved draft'}</Button></div>
      {preview === draft.id && <AgreementViewer title={draft.title} text={draft.text} version={draft.version} documentId={draft.id} digest={draft.digest}/>}
    </article>;
  })}</section>;
}
