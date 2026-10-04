import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, FileText, House, Layers, ListChecks, RefreshCw, UserRound } from 'lucide-react';
import { go, useRoute } from '../ui/router';
import { AgreementRecords } from './AgreementRecords';
import { ChainReference } from './ChainReference';
import { Button, Heading, money, Rows } from './Common';
import { TransactionHistory } from './TransactionHistory';
import type { DemoState } from './types';
import './dashboard.css';

type Props = { state: DemoState; role: 'investor' | 'provider'; children: ReactNode; refresh: () => void | Promise<void>; busy: boolean; refreshing?: boolean; account?: string };
const numeric = (value?: string) => { const number = Number(value?.replace(/\s+USDG$/, '')); return Number.isFinite(number) ? number : 0; };
const total = (values: (string | undefined)[]) => String(values.reduce<number>((sum, value) => sum + numeric(value), 0));

export function Dashboard({ state, role, children, refresh, busy, refreshing, account }: Props) {
  const route = useRoute().split('?')[0];
  const mobile = useRef<HTMLDetailsElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const previousRoute = useRef(route);
  const investor = role === 'investor';
  const items = [
    { path: '/', label: 'Overview', icon: House },
    { path: investor ? '/positions' : '/vehicles', label: investor ? 'My positions' : 'Investment vehicles', icon: Layers },
    { path: '/records', label: investor ? 'Transaction history' : 'Transactions', icon: ListChecks },
    { path: '/agreements', label: 'Agreements', icon: FileText },
    { path: '/account', label: 'Account', icon: UserRound },
  ];
  const current = items.find(item => item.path === route) || items[0];
  useEffect(() => {
    if (mobile.current) mobile.current.open = false;
    if (previousRoute.current !== route) title.current?.querySelector('h1')?.focus();
    previousRoute.current = route;
  }, [route]);
  const links = (mobileNav = false) => <nav aria-label={mobileNav ? 'Mobile account navigation' : 'Dashboard navigation'}>{items.map(({ path, label, icon: Icon }) =>
    <a key={path} href={`#${path}`} aria-current={current.path === path ? 'page' : undefined} className={path === '/account' ? 'dg-dashboard-account-link' : undefined}
      aria-disabled={busy || undefined} onClick={event => { if(busy){event.preventDefault();return;}if (mobile.current) mobile.current.open = false; }}><Icon size={17} aria-hidden="true"/><span>{label}</span></a>)}</nav>;
  const agreements = state.agreements || [];
  const renderContent = () => {
    if (route === '/positions' || route === '/vehicles') return children;
    if (route === '/records') return <><Heading title="Transaction history" copy="Your activity and transaction references."/><TransactionHistory receipts={state.receipts}/></>;
    if (route === '/agreements') return <><Heading title="Agreements" copy="Review and download your recorded documents."/><div className="dg-panel">{agreements.length ? <AgreementRecords agreements={agreements}/> : <div className="dg-dashboard-empty"><FileText size={23}/><h2>No agreements yet</h2><p>Your agreements will appear here after you sign.</p></div>}</div></>;
    if (route === '/account') return <><Heading title="Account" copy="Your linked identity and wallet."/><div className="dg-panel"><h2>Account details</h2><Rows items={[
      ['Full name', state.profile.identity?.name || 'Not available'],
      ['Jurisdiction', state.profile.identity?.jurisdiction || 'Not available'],
      ['Account type', investor ? 'Exit investor' : 'Capital provider'],
      ['Connected wallet', account ? <ChainReference value={account}/> : 'Not available'],
    ]}/></div></>;
    return <Overview state={state} role={role} busy={busy}/>;
  };
  return <div className="dg-dashboard">
    <aside className="dg-dashboard-sidebar"><div className="dg-dashboard-identity"><span>{investor ? 'Exit investor' : 'Capital provider'}</span><strong>{state.profile.identity?.name || 'Your account'}</strong></div>{links()}</aside>
    <div className="dg-dashboard-main" ref={title}>
      <details className="dg-dashboard-mobile" ref={mobile} onKeyDown={event => { if (event.key === 'Escape' && mobile.current?.open) { mobile.current.open = false; mobile.current.querySelector('summary')?.focus(); } }}>
        <summary aria-label="Navigation"><span>{current.label}</span><ChevronDown size={16}/></summary>{links(true)}
      </details>
      <div className="dg-dashboard-toolbar"><span>Account <span aria-hidden="true">/</span> <strong>{current.label}</strong></span><button className="dg-icon-button" onClick={() => void refresh()} disabled={busy || refreshing} aria-label={refreshing ? "Refreshing account" : "Refresh account"} aria-busy={refreshing}><RefreshCw size={16} className={refreshing ? "dg-spin" : undefined}/></button></div>
      <div className="dg-dashboard-content">{renderContent()}</div>
    </div>
  </div>;
}

function Overview({ state, role, busy }: Pick<Props, 'state' | 'role' | 'busy'>) {
  const investor = role === 'investor';
  const matched = state.positionStatus === 'matched';
  const positions = matched ? state.positions : [];
  const holdings = state.vehicles.filter(vehicle => [vehicle.providerPrincipal, vehicle.providerNav, vehicle.queued, vehicle.claimable].some(value => numeric(value) > 0));
  const payouts = state.receipts.filter(receipt => receipt.status === 'confirmed' && receipt.title === 'Early payout received');
  const receipts = [...state.receipts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3);
  const signed = (state.agreements || []).filter(agreement => Boolean(agreement.signedAt));
  const metrics = investor ? [
    { label: 'Available position units', value: matched ? money(total(positions.map(position => position.available))) : '—', unit: 'units' },
    { label: 'Early payout received', value: money(total(payouts.map(receipt => receipt.amount))), unit: 'USDG' },
    { label: 'Wallet balance', value: money(state.setup.usdg), unit: 'USDG' },
  ] : [
    { label: 'Your investment NAV', value: money(total(state.vehicles.map(vehicle => vehicle.providerNav))), unit: 'USDG' },
    { label: 'Income allocated', value: money(total(state.vehicles.map(vehicle => vehicle.income))), unit: 'USDG' },
    { label: 'Current vehicles', value: String(holdings.length), unit: holdings.length === 1 ? 'vehicle' : 'vehicles' },
  ];
  return <section className="dg-dashboard-overview">
    <Heading title="Overview" copy={`Welcome, ${state.profile.identity?.name || 'investor'}. Here is your account at a glance.`}/>
    <div className="dg-dashboard-metrics">{metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value} <small>{metric.unit}</small></strong></div>)}</div>
    <div className="dg-dashboard-section-title"><h2>{investor ? 'Your positions' : 'Your investments'}</h2><a href={investor ? '#/positions' : '#/vehicles'}>{investor ? 'View all' : 'Explore vehicles'}<ArrowUpRight size={14}/></a></div>
    {investor ? <>
      {state.positionStatus === 'mismatch' ? <div className="dg-panel dg-dashboard-empty"><h2>Position ownership could not be verified</h2><p>No private position details are shown for this identity.</p></div> : state.positionStatus === 'unavailable' ? <div className="dg-panel dg-dashboard-empty"><h2>Positions are unavailable</h2><p>Refresh your account to try again.</p></div> : positions.length === 0 ? <div className="dg-panel dg-dashboard-empty"><Layers size={23}/><h2>No supported positions yet</h2><p>Supported positions linked to your wallet will appear here.</p></div> : <div className="dg-dashboard-holdings">{positions.map(position => <article className="dg-panel" key={position.id}>
        <div className="dg-dashboard-holding-head"><span className="dg-dashboard-initials" aria-hidden="true">{position.originator.split(' ').map(word => word[0]).slice(0, 2).join('')}</span><div><h3>{position.name}</h3><p>{position.originator}</p></div></div>
        <p className="dg-dashboard-instrument">{position.instrument}</p><strong className="dg-dashboard-holding-value">{money(position.available)} <small>available units</small></strong>
        {position.restriction && <p>{position.restriction}</p>}<Button secondary disabled={busy || Boolean(position.restriction) || numeric(position.available) <= 0} onClick={() => go(`/positions?position=${encodeURIComponent(position.id)}`)}>Explore an exit <ArrowUpRight size={15}/></Button>
      </article>)}</div>}
    </> : <div className="dg-panel"><h3>{holdings.length ? `Capital held in ${holdings.length} ${holdings.length === 1 ? 'vehicle' : 'vehicles'}` : 'Start with an investment vehicle'}</h3><p className="dg-dashboard-invest-copy">Review each vehicle’s mandate, eligibility and terms before investing.</p>{holdings.length > 0 && <Rows items={holdings.map(vehicle => [vehicle.name, `${money(vehicle.providerNav)} USDG`] as [string, ReactNode])}/>}<Button secondary onClick={() => go('/vehicles')} disabled={busy}>Invest <ArrowUpRight size={15}/></Button></div>}
    <div className="dg-dashboard-section-title"><h2>Recent activity</h2><a href="#/records">View all<ArrowUpRight size={14}/></a></div>
    <TransactionHistory receipts={receipts}/>
    <a className="dg-dashboard-document-link" href="#/agreements"><FileText size={20}/><span><strong>Your agreements</strong><small>{signed.length ? `${signed.length} signed ${signed.length === 1 ? 'document' : 'documents'} available to review` : 'Your signed documents will be saved here'}</small></span><ArrowUpRight size={17}/></a>
  </section>;
}
