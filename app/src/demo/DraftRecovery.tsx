import { go } from '../ui/router';
import { Button, Heading, Notice } from './Common';
export function DraftRecovery({ draftId, kind, message, busy, renewed }: { draftId: string; kind: 'exit' | 'subscription'; message: string; busy: boolean; renewed?: boolean }) {
  const path = kind === 'exit' ? 'positions' : 'vehicles';
  return <section className="dg-narrow"><Heading title="This draft needs another review." copy="Your saved document remains available in Agreements."/><Notice error>{message}</Notice><div className="dg-actions">
    {!renewed && <Button disabled={busy} onClick={() => go(`/${path}?draft=${encodeURIComponent(draftId)}&renew=1`)}>Review current terms</Button>}
    <Button secondary disabled={busy} onClick={() => go('/agreements')}>Back to Agreements</Button>
    {renewed && <Button secondary disabled={busy} onClick={() => go(`/${path}`)}>Choose current {kind === 'exit' ? 'positions' : 'vehicles'}</Button>}
  </div></section>;
}
