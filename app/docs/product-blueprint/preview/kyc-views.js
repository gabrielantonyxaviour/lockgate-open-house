import {demoProfiles,profileFor,holdingAccess,vehicleApproved} from './identity-fixtures.js';
import {originators} from './data.js';
import {button,badge,panel,rows,notice,escape} from './ui.js';
export function kycView(id,s){
  const profile=profileFor(s),investor=s.role==='investor';
  if(id==='kyc-start')return panel('Verify your identity first',`<p>${investor?'Start with KYC, then securely discover supported holdings and debentures that belong to you.':'Start with KYC, then check your eligibility for a firm’s investment vehicle.'}</p>${notice('TEST journey','Start KYC opens ten preverified fictional profiles. No identity provider, wallet or account is contacted.')}<div class="actions">${button('Start KYC','start-kyc')}</div>`,'narrow');
  if(id==='kyc-profiles')return `<p class="profile-intro">Choose a preverified TEST identity. Verification and ownership are separate checks.</p><div class="profile-grid" role="group" aria-label="Ten preverified TEST profiles">${demoProfiles.map(p=>`<button class="profile-card ${s.profileId===p.id?'selected':''}" data-action="profile" data-value="${p.id}" aria-pressed="${s.profileId===p.id}"><span class="profile-card-head"><span class="avatar">${p.name.split(' ').map(x=>x[0]).join('')}</span><span class="radio"></span></span><strong>${p.name}</strong><span>${p.jurisdiction}</span><small>${p.identityRef}</small><span class="profile-case">${p.fixtureCase==='mismatch'?'Verified identity · ownership mismatch':p.fixtureCase==='empty'?'Verified identity · no holdings':'Verified identity · matched holding'}</span></button>`).join('')}</div><div class="profile-actions"><p>${profile?`${escape(profile.name)} selected · preverified TEST identity`:'No profile selected'}</p>${button(investor?'Find supported holdings':'Explore investment vehicles','kyc-continue','primary',profile?'':'disabled')}</div>`;
  if(id==='identity')return profile?panel('Selected TEST identity',`${badge('Preverified TEST profile')}${rows([['Name',escape(profile.name)],['Identity reference',profile.identityRef],['Attestation',profile.attestationRef],['Bound account',profile.accountRef],['Bound wallet fixture',profile.walletRef],['Expires',profile.expires]])}${notice('Identity is not asset ownership','The originating register must separately attest the same subject, account and wallet before an exit can proceed.')}<div class="actions">${button('Find supported holdings','kyc-continue')}${button('Change TEST profile','choose-profile','secondary')}</div>`,'narrow'):accessGate('kyc-required',s);
  if(id==='match')return discovery(s);
  return null;
}
function discovery(s){
  const access=holdingAccess(s),profile=profileFor(s);
  if(access.status!=='matched')return accessGate(access.status,s);
  const o=originators[access.originator];
  return `${notice('Ownership matched · TEST evidence',`${escape(profile.name)}’s identity, authenticated account and wallet fixture match the originator’s holding attestation.`,'good')}${panel('Your supported holding',`<div class="asset-row"><span class="avatar">${o.initials}</span><div><h3>${o.name}</h3><p>${o.asset}</p></div>${badge('Matched')}</div>${rows([['Register',o.register],['Holding reference',access.holdingRef],['Face value','100,000.00 USDG'],['Ownership check','Subject + account + wallet IDs'],['Transfer scope',o.partial?'Approved divisible position':'Full claim assignment only']])}<div class="actions">${button(o.model==='offchain'?'Link my verified record':'View my position','next')}${button('Change TEST profile','choose-profile','secondary')}</div>`)}<p class="muted small profile-footnote">Only matched holdings are shown. A verified identity cannot reveal or exit someone else’s investment.</p>`;
}
export function accessGate(status,s){
  const profile=profileFor(s);
  const messages={
    'kyc-required':['Start KYC to continue','Choose a preverified TEST profile before any personal holding, agreement or payout is shown.'],
    mismatch:['Identity mismatch','We couldn’t verify this position belongs to your approved identity.'],
    empty:['No supported positions found for this wallet.','This TEST identity and account match. The supported registers returned no holdings or debentures for this person. This is not an identity mismatch.'],
    'no-position':['No matching holding at this originator','Your selected identity has no verified position at this originator. Return to your matched records before requesting an exit.'],
    'choose-vehicle':['Choose your investment vehicle','Your TEST identity is verified. Choose a firm’s vehicle before its specific suitability and eligibility review.'],
    'vehicle-required':['Check vehicle eligibility','KYC is complete. The firm must separately approve this identity for the selected vehicle before subscription, funding or personal records.'],
  };
  const [title,copy]=messages[status]||messages['kyc-required'];
  return panel(title,`${profile?badge(`${escape(profile.name)} · preverified TEST identity`):''}<p class="access-copy">${copy}</p>${status==='mismatch'?notice('KYC remains valid','This person may still apply as a capital provider, subject to that vehicle’s eligibility. No originating holding is required for that role.') :''}<div class="actions">${button(status==='kyc-required'?'Start KYC':status==='mismatch'?'Change profile':status==='choose-vehicle'?'Explore vehicles':status==='vehicle-required'?'Review vehicle eligibility':'Choose another TEST profile',status==='choose-vehicle'?'provider-browse':status==='vehicle-required'?'provider-eligibility':'choose-profile')}${status==='no-position'?button('Find my holdings','rediscover','secondary'):''}</div>`,'narrow access-gate');
}
export function kycInspector(s){
  const p=profileFor(s),status=s.role==='investor'?holdingAccess(s).status:vehicleApproved(s)?'vehicle-approved':p?'identity-only':'kyc-required';
  return `<div class="identity-inspector"><h3>Current TEST identity boundary</h3><p>${p?`${escape(p.name)} · ${p.identityRef} · ${p.attestationRef}`:'No TEST identity selected'} · ${status}. Exact trusted subject, account and wallet references drive the fixture match; names never authorize access. No authentication, KYC request, profile session or wallet connection occurred. Provider vehicle approval is separate from originator holdings.</p></div>`;
}
