import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { DemoRole, Profile } from './types';
import { roles } from './fixtures';
import './profile-menu.css';

type Props = { profile: Profile; role: 'investor' | 'provider'; busy: boolean; switchProfile: (role: DemoRole) => void; addProfile: () => void };
export function ProfileMenu({ profile, role, busy, switchProfile, addProfile }: Props) {
 const [open, setOpen] = useState(false);
 const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
 const id = useId();
 const entries = roles.filter(item => profile.roles.includes(item.id) && (item.id === 'investor' || item.id === 'provider'));
 const label = roles.find(item => item.id === role)?.title;
 const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
 useEffect(() => {
  if (!open) return;
  menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown', outside);
  return () => document.removeEventListener('pointerdown', outside);
 }, [open]);
 const keys = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
 };
 return <div className="dg-profile-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
  <strong className="dg-profile-name">{profile.identity?.name || 'Your account'}</strong>
  <button ref={trigger} className="dg-profile-trigger" disabled={busy} aria-label={`Profile: ${label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
   <span>{label}</span><ChevronDown size={14} aria-hidden="true"/>
  </button>
  {open && <div ref={menu} id={id} className="dg-profile-popover" role="menu" aria-label="Profiles" onKeyDown={keys}>
   {entries.map(item => <button key={item.id} role="menuitemradio" aria-checked={role === item.id} disabled={busy} onClick={() => { close(true); if (item.id !== role) switchProfile(item.id); }}><item.icon size={16} aria-hidden="true"/><span>{item.title}</span>{role === item.id && <Check size={15} aria-hidden="true"/>}</button>)}
   <div className="dg-profile-divider" role="separator"/>
   <button role="menuitem" disabled={busy} onClick={() => { close(); addProfile(); }}><Plus size={16} aria-hidden="true"/><span>Add New Profile</span></button>
  </div>}
 </div>;
}
