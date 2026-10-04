import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { ChainReference, ReferenceText } from './ChainReference';
import { AgreementRecords } from './AgreementRecords';
import { Rows } from './Common';
import type { AgreementRecord, Receipt } from './types';
import './transaction-history.css';

export function TransactionHistory({ receipts, agreements = [] }: {
  receipts: Receipt[];
  agreements?: AgreementRecord[];
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = receipts.find(receipt => receipt.id === selectedId);
  return <section className="dg-panel dg-transaction-history">
    <h2>Transaction History</h2>
    {receipts.length === 0 ? <p className="dg-empty">Your confirmed activity and submitted transaction references will appear here.</p> :
      <div className="dg-records">{receipts.map(receipt => {
        const linked = agreements.filter(agreement => agreement.receiptId === receipt.id);
        const usefulDetails = Boolean(receipt.residual || linked.length || (receipt.detail?.length ?? 0) > 140);
        const href = explorerUrl(receipt);
        const detail = receipt.detail;
        return <article key={receipt.id}>
          <div className="dg-transaction-summary">
            {usefulDetails ? <button className="dg-transaction-title" onClick={() => setSelectedId(receipt.id)} aria-label={`View details for ${receipt.title}`}>{receipt.title}</button> : <strong>{receipt.title}</strong>}
            <p>{detail?<ReferenceText text={detail}/>:receipt.createdAt}</p>
            {receipt.amount && <span>{receiptAmount(receipt.amount)}</span>}
          </div>
          <div className="dg-record-end"><span className={`dg-badge ${receipt.status === 'confirmed' ? '' : 'dg-muted-badge'}`}>{receipt.status}</span>
            {href ? <a className="dg-icon-button dg-transaction-explorer" href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${receipt.title} transaction in explorer`} title="View transaction in explorer"><ExternalLink size={17}/></a> : receipt.hash && <code title={receipt.hash}>{receipt.hash.slice(0, 10)}…{receipt.hash.slice(-6)}</code>}
          </div>
        </article>;
      })}</div>}
    {agreements.length > 0 && <div className="dg-history-agreements"><h3>Agreements</h3><AgreementRecords agreements={agreements}/></div>}
    {selected && <TransactionDetails receipt={selected} agreements={agreements.filter(agreement => agreement.receiptId === selected.id)} onClose={() => setSelectedId(undefined)}/>}
  </section>;
}

function TransactionDetails({ receipt, agreements, onClose }: {
  receipt: Receipt;
  agreements: AgreementRecord[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    heading.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const items: [string, ReactNode][] = [
    ['Status', receipt.status], ['Recorded', receipt.createdAt], ['Account', <ChainReference value={receipt.account}/>],
  ];
  if (receipt.amount) items.push(['Amount', receiptAmount(receipt.amount)]);
  if (receipt.residual) items.push(['Residual units', receipt.residual]);
  if (receipt.hash) items.push(['Transaction hash', <ChainReference value={receipt.hash} transaction/>]);
  items.push(['Receipt', receipt.id]);
  const href = explorerUrl(receipt);
  return <dialog ref={dialog} className="dg-transaction-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header><h2 ref={heading} tabIndex={-1} id={titleId}>{receipt.title}</h2><button className="dg-icon-button" aria-label="Close transaction details" onClick={onClose}><X size={19}/></button></header>
    {receipt.detail && <p className="dg-transaction-detail"><ReferenceText text={receipt.detail}/></p>}
    <Rows items={items}/>
    {href && <a className="dg-button dg-secondary" href={href} target="_blank" rel="noopener noreferrer">View transaction in explorer <ExternalLink size={15}/></a>}
    {agreements.length > 0 && <div className="dg-history-agreements"><h3>Linked agreements</h3><AgreementRecords agreements={agreements}/></div>}
  </dialog>;
}

function explorerUrl(receipt: Receipt) {
  if (receipt.hash && /^0x[0-9a-f]{64}$/i.test(receipt.hash)) return `https://sepolia.arbiscan.io/tx/${receipt.hash}`;
  if (!receipt.explorerUrl) return undefined;
  try {
    const url = new URL(receipt.explorerUrl);
    if (url.protocol === 'https:' && url.hostname === 'sepolia.arbiscan.io' && !url.username && !url.password && /^\/tx\/0x[0-9a-f]{64}$/i.test(url.pathname)) return url.href;
  } catch { /* Invalid references are displayed without an external action. */ }
  return undefined;
}

function receiptAmount(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:\s+(ETH|USDG))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, whole, fraction, unit] = match;
  const integer = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimal = fraction?.replace(/0+$/, '');
  return `${sign}${integer}${decimal ? `.${decimal}` : ''} ${unit || 'USDG'}`;
}
