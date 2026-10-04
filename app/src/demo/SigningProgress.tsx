import { useEffect, useRef, type ReactNode } from 'react';
import { Check, ExternalLink, LoaderCircle, Wallet } from 'lucide-react';
import type { WalletProgress } from './types';
import './signing-progress.css';

export function SigningProgress({ progress, signed, kind = 'exit', children }: { progress?: WalletProgress; signed: boolean; kind?: 'exit' | 'fund'; children?: ReactNode }) {
  const ready = useRef<HTMLHeadingElement>(null);
  const previousSigned = useRef(signed);
  useEffect(() => {
    if (signed && !previousSigned.current) ready.current?.focus();
    previousSigned.current = signed;
  }, [signed]);
  const phase = progress?.phase;
  const transaction = Boolean(phase?.startsWith('transaction-') || phase?.startsWith('approval-'));
  const complete = phase === 'transaction-confirmed';
  const pending = Boolean(phase && phase !== 'acceptance-confirmed' && phase !== 'transaction-confirmed' && phase !== 'transaction-unknown');
  const firstComplete = signed || phase === 'acceptance-confirmed' || transaction;
  const titles: Partial<Record<WalletProgress['phase'], string>> = {
    'reservation-pending': 'Preparing the agreement reservation…',
    'signature-requested': 'Sign the agreement in your wallet',
    'signature-collected': 'Signature received. Recording acceptance…',
    'acceptance-pending': 'Recording agreement acceptance…',
    'acceptance-confirmed': kind === 'exit' ? 'Ready for your payout transaction' : 'Ready to fund your subscription',
    'transaction-requested': kind === 'exit' ? 'Confirm your payout transaction in your wallet' : 'Confirm your deposit in your wallet',
    'transaction-submitted': kind === 'exit' ? 'Payout transaction pending…' : 'Deposit transaction pending…',
    'transaction-confirmed': kind === 'exit' ? 'Payout transaction confirmed' : 'Deposit transaction confirmed',
    'transaction-unknown': 'Transaction submitted. Confirmation is unresolved.',
    'approval-requested': 'Approve USDG access in your wallet',
    'approval-submitted': 'USDG approval pending…',
    'approval-confirmed': 'USDG approved. Confirm your deposit in your wallet.',
  };
  return <section className="dg-signing-progress" aria-label="Wallet steps">
    <ol>
      <li data-complete={firstComplete}><span>{firstComplete ? <Check size={14}/> : '1'}</span><div><strong>Sign agreement</strong><small>Wallet signature, then agreement acceptance.</small></div></li>
      <li data-complete={complete}><span>{complete ? <Check size={14}/> : '2'}</span><div><strong>{kind === 'exit' ? 'Confirm payout' : 'Approve & deposit'}</strong><small>{kind === 'exit' ? 'A separate wallet transaction releases your payout.' : 'USDG approval, if needed, then a separate deposit transaction.'}</small></div></li>
    </ol>
    <div className="dg-signing-status" role="status" aria-live="polite">
      {pending ? <LoaderCircle size={18} className="dg-spin"/> : complete ? <Check size={18}/> : <Wallet size={18}/>}
      <div><h3 ref={ready} tabIndex={-1}>{phase ? titles[phase] : signed ? (kind === 'exit' ? 'Ready for your payout transaction' : 'Ready to fund your subscription') : 'Two wallet steps to complete'}</h3>
        {!phase && !signed && <p>First sign this agreement. After acceptance, confirm {kind === 'exit' ? 'your payout' : 'the funding transaction'} separately in your wallet.</p>}
        {firstComplete && !transaction && <p>{kind === 'exit' ? 'Your agreement is accepted. Use “Confirm payout in wallet” below to authorize the separate payout transaction.' : 'Your signed agreement is accepted. Continue below to approve USDG access if needed and confirm the deposit.'}</p>}
        {(phase === 'signature-collected' || phase === 'acceptance-pending') && <p>Your wallet signature is complete. Wait for the agreement acceptance to be recorded before the next wallet transaction.</p>}
      </div>
    </div>
    {children}
    {progress?.hash && /^0x[0-9a-f]{64}$/i.test(progress.hash) && <a href={`https://sepolia.arbiscan.io/tx/${progress.hash}`} target="_blank" rel="noopener noreferrer">View transaction in explorer <ExternalLink size={13}/></a>}
  </section>;
}
