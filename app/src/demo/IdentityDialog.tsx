import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { Button, Notice } from './Common';
import { identities } from './fixtures';
import './identity-dialog.css';

export function IdentityDialog({ onClose, onSelect, busy, error }: {
  onClose: () => void;
  onSelect: (id: string) => void;
  busy: boolean;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    heading.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Requested TEST-profile presentation delay, never a provider verification.
    const timer = window.setTimeout(() => setLoading(false), 2200);
    return () => {
      window.clearTimeout(timer);
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return <dialog ref={dialog} className="dg-identity-dialog"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div className="dg-identity-dialog-header">
      <span className="dg-badge">TEST identity</span>
      <button className="dg-icon-button" aria-label="Close identity verification" disabled={busy} onClick={onClose}><X size={19}/></button>
    </div>
    <div className="dg-identity-dialog-copy">
      <h2 ref={heading} tabIndex={-1} id={titleId}>Identity verification</h2>
      <p id={descriptionId}>Each test profile is preverified. Position ownership is checked separately.</p>
    </div>
    {busy ? <div className="dg-identity-progress" role="status" aria-live="polite">
      <LoaderCircle size={28} className="dg-spin"/>
      <h3>Completing KYC…</h3>
      <p>Linking your selected TEST profile to your wallet. Confirm the transaction in your wallet and wait for confirmation.</p>
    </div> : loading ? <div className="dg-identity-progress" role="status" aria-live="polite">
      <LoaderCircle size={28} className="dg-spin"/>
      <h3>Loading test profiles…</h3>
      <p>Preparing the ten preverified TEST profiles.</p>
    </div> : <>
      <div className="dg-profile-choices">
        <h3>Choose a profile.</h3>
        <div className="dg-profile-grid" role="radiogroup" aria-label="TEST identity">
          {identities.map((profile, index) => <label key={profile.id} className={`dg-profile-choice ${selected === profile.id ? 'selected' : ''}`}>
            <input type="radio" name="identity" value={profile.id} aria-label={profile.name}
              checked={selected === profile.id} onChange={() => setSelected(profile.id)}/>
            <ProfileAvatar index={index}/>
            <span className="dg-profile-details"><strong>{profile.name}</strong><span>{profile.jurisdiction}</span>
              <small><ShieldCheck size={12}/>Preverified TEST profile</small>
              {profile.fixtureCase !== 'match' && <small>{profile.fixtureCase === 'mismatch' ? 'Holding-owner mismatch case' : 'No supported holdings case'}</small>}
            </span>
            <span className="dg-profile-indicator" aria-hidden="true">{selected === profile.id && <Check size={12}/>}</span>
          </label>)}
        </div>
      </div>
      <div className="dg-identity-dialog-footer">
        {error && <Notice error>{error}</Notice>}
        <p>Confirm your selection to link this profile to your wallet.</p>
        <div className="dg-identity-dialog-buttons"><Button secondary onClick={onClose}>Cancel</Button><Button disabled={!selected} onClick={() => onSelect(selected)}>Use selected profile</Button></div>
      </div>
    </>}
  </dialog>;
}

// Deterministic local illustrations; these are not photographs of real people.
function ProfileAvatar({ index }: { index: number }) {
  const backgrounds = ['#e8e8e8', '#dedede', '#f0f0f0', '#e3e3e3', '#ececec'];
  const hair = index % 3;
  return <svg className="dg-profile-avatar" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <rect width="48" height="48" rx="24" fill={backgrounds[index % 5]}/>
    <path d="M8 48c0-13 7-19 16-19s16 6 16 19" fill={index % 2 ? '#696969' : '#8a8a8a'}/>
    {hair === 1 && <path d="M13 32V20c0-10 22-10 22 0v12" fill="#424242"/>}
    <ellipse cx="24" cy="21" rx="9" ry="11" fill="#c3c3c3"/>
    <path d={hair === 0 ? 'M15 21V17c0-11 19-10 19 0v4l-5-7-14 7' : hair === 1 ? 'M14 21c-2-15 22-15 20 0l-10-7-10 7' : 'M15 17c1-10 18-10 19 1l-19-1'} fill="#424242"/>
    <circle cx="21" cy="22" r="1" fill="#424242"/><circle cx="28" cy="22" r="1" fill="#424242"/>
    <path d="M21 27q3 2 6 0" fill="none" stroke="#696969" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>;
}
