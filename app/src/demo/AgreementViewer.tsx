import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { Button } from './Common';
import { paginateAgreement } from './agreement-pages';
import { downloadAgreement, printAgreement } from './agreement-export';
import './legal-document.css';

export function AgreementViewer({ title, text, version, documentId, digest, signed = false }: {
  title: string; text: string; version: string; documentId: string; digest: string; signed?: boolean;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [layoutError, setLayoutError] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLPreElement>(null);
  const pageId = useId();
  useLayoutEffect(() => {
    const container = body.current, measure = probe.current;
    if (!container || !measure) return;
    let active = true;
    const paginate = () => {
      if (!active || container.clientWidth < 1 || container.clientHeight < 1) return;
      measure.style.width = `${container.clientWidth}px`;
      try {
      const next = paginateAgreement(text, value => {
        measure.textContent = value;
        return measure.getBoundingClientRect().height <= container.clientHeight - 2;
      });
      setPages(next); setLayoutError(''); setPage(current => Math.min(current, next.length - 1));
      } catch { setLayoutError('The preview could not fit this page. Download the original or use Print / PDF to review the complete agreement.'); }
    };
    paginate();
    const observer = new ResizeObserver(paginate); observer.observe(container);
    void document.fonts.ready.then(paginate);
    return () => { active = false; observer.disconnect(); };
  }, [text]);
  useEffect(() => { setPage(0); setError(''); }, [documentId, digest]);
  const changePage = (next: number) => setPage(Math.max(0, Math.min(pages.length - 1, next)));
  return <section className="dg-agreement-viewer" aria-label="Agreement document viewer">
    <div className="dg-legal-toolbar"><div><strong>Agreement preview</strong><span>{signed ? 'Signed agreement' : 'Unsigned draft'} · Version {version}</span></div><div className="dg-legal-exports">
      <Button secondary onClick={() => downloadAgreement(documentId, text)}><Download size={14}/>Download .txt</Button>
      <Button secondary onClick={() => { try { printAgreement(title, text, documentId, digest, signed); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open print preview.'); } }}><Printer size={14}/>Print / PDF</Button>
    </div></div>
    {error && <p className="dg-viewer-error" role="alert">{error}</p>}
    {layoutError && <p className="dg-viewer-error" role="alert">{layoutError}</p>}
    <div className="dg-legal-pagination" aria-label="Document pages">
      <button type="button" className="dg-icon-button" aria-label="Previous page" disabled={page === 0} onClick={() => changePage(page - 1)}><ChevronLeft size={18}/></button>
      <div><label htmlFor={pageId}>Page</label><select id={pageId} value={page} onChange={event => changePage(Number(event.target.value))}>{pages.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}</select><span aria-live="polite">of {pages.length || '…'}</span></div>
      <button type="button" className="dg-icon-button" aria-label="Next page" disabled={!pages.length || page >= pages.length - 1} onClick={() => changePage(page + 1)}><ChevronRight size={18}/></button>
    </div>
    <div className="dg-legal-stage">
      <article className="dg-legal-paper" tabIndex={0} aria-label={`${title}, page ${page + 1} of ${pages.length || 1}`} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); changePage(event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : page + (event.key === 'ArrowRight' ? 1 : -1));
        }
      }}>
        <header className="dg-legal-letterhead"><span className="dg-legal-wordmark">Lockgate<span>.</span></span><span>{signed ? 'Signed copy' : 'Draft for review'}<br/>Version {version}</span></header>
        {page === 0 && <h2 className="dg-legal-title">{title}</h2>}
        <div ref={body} className="dg-legal-page-body"><pre className="dg-legal-text">{pages[page] ?? 'Preparing document pages…'}</pre></div>
        <footer className="dg-legal-page-footer"><span>{title}</span><span>{page + 1} / {pages.length || '…'}</span></footer>
      </article>
    </div>
    <details className="dg-legal-reference"><summary>Agreement reference</summary><p>{documentId}</p><code>{digest}</code></details>
    <pre ref={probe} className="dg-legal-text dg-legal-measure" aria-hidden="true"/>
  </section>;
}
