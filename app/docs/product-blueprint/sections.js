import { meta } from './meta.js';
import { compliance } from './compliance.js';
import { economics } from './economics.js';
import { personas } from './personas.js';
import { features } from './features.js';
import { acceptance } from './acceptance.js';
import { experience } from './experience.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escape;
const labels = {existing:'Exists today',current:'Exists today',partial:'Partly implemented',proposed:'Proposed',blocked:'Blocked',open:'Decision / work needed',provisional:'Provisional',confirmed:'Direction confirmed',evidenced:'Historical evidence'};
const pill = state => `<span class="state ${e(state)}">${e(labels[state] || state)}</span>`;
const list = items => `<ul>${items.map(item => `<li>${e(item)}</li>`).join('')}</ul>`;
const field = (title, value) => `<div><span class="field-title">${e(title)}</span><p>${e(value)}</p></div>`;
const fields = items => `<div class="grid">${items.map(([title,value]) => field(title,value)).join('')}</div>`;
const review = (key, title) => `<div class="review" data-review="${e(key)}"><label><input type="checkbox" aria-label="Reviewed: ${e(title)}">Reviewed</label><textarea maxlength="2000" rows="2" aria-label="Review note: ${e(title)}" placeholder="Question, correction or decision to discuss…"></textarea></div>`;
const detail = (id, title, body, state, open = false) => `<details id="${e(id)}"${open ? ' open' : ''}><summary><span>${e(title)}</span>${state ? pill(state) : ''}</summary><div class="body">${body}</div></details>`;
const heading = (number, title, intro) => `<span class="eyebrow">${number} · Review blueprint</span><h2>${e(title)}</h2><p class="muted">${e(intro)}</p>`;
const roleName = id => personas.find(p => p.id === id)?.name || (id === 'internal' ? 'Internal operations' : id);
export const decisions = [...economics.decisions, ...meta.decisions, ...compliance.decisions];

export function renderSections() {
  document.querySelector('#overview').innerHTML = heading('01','One product, four customer journeys','Start with the purpose and ownership of each role. Public browsing comes before task-specific onboarding.') +
    `<div class="grid four">${personas.map((p,i) => `<a class="card overview-role" href="#journey-${e(p.id)}"><span class="eyebrow">0${i+1} · Public role</span><strong>${e(p.name)}</strong><p>${e(p.job)}</p><span class="arrow">Review full journey ↗</span></a>`).join('')}</div>` +
    `<div class="notice">Lockgate operations is internal. Choosing a role changes navigation; permissions, eligibility and economic ownership come from separate authoritative records.</div>` +
    detail('confirmed-direction','What you have already directed',list(meta.confirmed),'confirmed',true) +
    `<div class="legend">${['existing','partial','proposed','open','provisional'].map(pill).join('')}</div><p class="fine">These labels describe source inspection and product direction. They are not a claim that the future product is tested or legally cleared.</p>` +
    detail('implementation-gaps','Important gaps in today’s implementation',`<div class="grid">${meta.gaps.map(([title,body]) => `<article class="card"><h3>${e(title)}</h3><p>${e(body)}</p></article>`).join('')}</div>`,'partial') +
    detail('history','How the model changed',`<div class="history">${meta.history.map(([date,body]) => `<article><strong>${e(date)}</strong><p>${e(body)}</p></article>`).join('')}</div>`);

  document.querySelector('#experience').innerHTML = heading('02','What a visitor sees and how the app behaves','A review sketch of public arrival, followed by the shared experience contract. This defines proposed layouts and states; it is not an app implementation.') +
    `<div class="entry-sketch"><div class="sketch-header"><strong>lockgate.</strong><span>Connect wallet · Check profile</span></div><div class="sketch-body"><span class="eyebrow">Current entry · review sketch only</span><h3>Connect your wallet.</h3><p>Completed profile → dashboard. Incomplete → resume. New profile → choose a task.</p><p><a href="./journey-specs/entry-and-build-order.md">Review wallet-first routing ↗</a></p><details><summary>Four choices · connected new profiles only</summary><div class="grid">${[
      ['investor','Get an earlier exit','Find my position and compare earlier payouts.'],
      ['originator','Enable exits for my fund','Review support requirements and integration.'],
      ['manager','Manage my firm’s vault','Review mandates, proposals and obligations.'],
      ['provider','Provide capital through a firm','Explore eligible vaults and their terms.'],
    ].map(([id,title,body]) => `<a class="card overview-role" href="#journey-${id}"><strong>${e(title)}</strong><p>${e(body)}</p><span class="arrow">Review this proposed journey ↗</span></a>`).join('')}</div></details><p class="fine">This diagram reviews routing. It does not connect a wallet or retrieve a profile.</p></div></div>` +
    detail('arrival-behavior','Arrival, connection and return behavior',experience.arrival.map(a => `<article class="step"><h3>${e(a.title)}</h3><p>${e(a.body)}</p></article>`).join(''),'proposed') +
    detail('ux-patterns',`${experience.patterns.length} screen and component patterns`,experience.patterns.map(p => detail(`pattern-${p.id}`,p.title,fields([['Screen',p.screen],['Layout',p.layout],['Components',p.components],['Reachable states',p.states],['Reference and adaptation',p.reference]])+review(`pattern-${p.id}`,p.title),'proposed')).join('')) +
    detail('ux-principles','Shared product and design rules',list(experience.principles),'proposed');

  document.querySelector('#money').innerHTML = heading('03','Follow money and ownership','The proposed provider-capital structure must be agreed before a deposit interface can become a complete investment product.') +
    `<div class="flow">${[
      ['Capital provider','Subscribes to the firm’s approved vehicle and receives their own defined interest.'],
      ['Firm’s liquidity vehicle','Holds capital, values shares and manages credit exposure. The current on-chain path pays the exiting investor directly.'],
      ['Originating fund / platform','Supplies authoritative ownership and settlement records. Route B names a borrower and new financing obligation; route A needs permitted transfer or assignment.'],
      ['Exiting investor','Receives the agreed payout. Route A sells a specified asset or claim; route B settles and discharges the exited entitlement.'],
    ].map(([title,body]) => `<article class="card"><strong>${e(title)}</strong><p>${e(body)}</p></article>`).join('')}</div>` +
    `<div class="notice note">Payout: approved provider capital → firm’s vehicle → exiting investor. Route A: the vehicle acquires permitted units or a repayment claim and receives their proceeds. Route B: the old investor claim is discharged; the named borrower owes the vehicle under a separate financing agreement. Discount, new debt and realized income are separately agreed. Collateral, subscription cash and claimable withdrawals stay separately accounted.</div>` +
    `<p>${e(economics.summary)}</p>` + economics.steps.map(step => detail(step.id,`${step.id} · ${step.title}`,fields([['Parties',step.party],['Money movement',step.money],['Rights and obligations',step.rights],['Controls and unresolved detail',step.guards]]) + review(step.id,step.title),step.status)).join('') +
    detail('invariants','Rules that must hold across every flow',list(economics.invariants),'proposed') +
    detail('economic-scope','Current scope versus future product',economics.scope.map(s => `<article class="step"><div class="step-head"><h3>${e(s.title)}</h3>${pill(s.status)}</div><p>${e(s.body)}</p></article>`).join(''));

  document.querySelector('#onboarding').innerHTML = heading('04','KYC, agreements and investment acceptance',compliance.summary) +
    `<div class="onboarding-flow">${compliance.steps.map((s,i) => `<a href="#${e(s.id)}"><span>0${i+1}</span>${e(s.title)}</a>`).join('')}</div>` +
    compliance.steps.map(s => detail(s.id,`${s.id} · ${s.title}`,`<p>${e(s.body)}</p>${field('Required record',s.proof)}${review(s.id,s.title)}`,'proposed')).join('') +
    detail('organization-checks','Business and exiting-investor checks',`<div class="grid">${compliance.organizations.map(s => `<article class="card"><h3>${e(s.title)}</h3><p>${e(s.body)}</p></article>`).join('')}</div>`,'proposed') +
    detail('test-profiles','Test identity profiles for the demo',`<p class="notice note">${e(compliance.demoBoundary)}</p><div class="grid">${compliance.profiles.map(s => `<article class="card"><span class="eyebrow">${e(s.id)}</span><h3>${e(s.title)}</h3>${field('Starting state',s.state)}${field('Scenario',s.exercise)}</article>`).join('')}</div>`,'proposed') +
    `<p class="fine">Electronic signing can support online agreements under Singapore’s framework; the selected vehicle, document formalities and required parties still need review. <a href="${e(compliance.sources[0].path)}" target="_blank" rel="noopener noreferrer">IMDA guidance ↗</a></p>`;

  document.querySelector('#journeys').innerHTML = heading('05','Every journey, from arrival to ongoing use','Each step names the screen, the information shown, the action, who may act, how success is proved and how failure is recovered.') +
    personas.map(p => detail(`journey-${p.id}`,p.name,
      `<p>${e(p.job)}</p>${fields([['Entry',p.entry],['First view',p.firstView],['Workspace home',p.home],['Authority',p.authority]])}` +
      `<div class="journey-map">${p.journey.map((s,i) => `<a href="#${e(s.id)}"><span>${String(i+1).padStart(2,'0')}</span>${e(s.title)}</a>`).join('')}</div>` +
      p.journey.map(s => detail(s.id,s.title,fields([['Screen',s.screen],['What the user sees',s.see],['What they do',s.action],['Who may act',s.permission],['Confirmation',s.confirmation],['Failure / recovery',s.failure]])+review(s.id,`${p.name}: ${s.title}`),s.status)).join('') +
      `<div class="grid"><article class="card"><h3>Ongoing use</h3>${list(p.ongoing)}</article><article class="card"><h3>Still to settle</h3>${list(p.open)}</article></div>`,undefined)).join('');

  document.querySelector('#inventory').innerHTML = heading('06','Screen and action inventory','Search a screen, action, permission or proof requirement. This includes existing financial controls and the proposed commercial journeys.') +
    `<div class="filters"><input id="search" type="search" aria-label="Search screens and actions" placeholder="Search screens, actions or permissions…"></div><div class="filters" aria-label="Filter by persona"><button data-role="all" aria-pressed="true">All</button>${personas.map(p => `<button data-role="${e(p.id)}" aria-pressed="false">${e(p.name)}</button>`).join('')}<button data-role="internal" aria-pressed="false">Internal operations</button></div><p id="feature-count" class="count" role="status"></p>` +
    `<div id="feature-list">${features.map(f => detail(`feature-${f.id}`,`${f.id} · ${f.title}`,`<p class="route">${e(f.route)}</p>${fields([['Personas',f.personas.length ? f.personas.map(roleName).join(' · ') : 'Internal operations'],['Capability',f.capability],['Permission boundary',f.permission],['Current evidence / gap',f.evidence]])}${field('Required acceptance', '')}${list(f.checks)}${review(`feature-${f.id}`,f.title)}`,f.status)).join('')}</div><div id="feature-empty" class="notice skipped">No matching screens or actions. Try a broader search or choose All.</div>`;

  document.querySelector('#decisions').innerHTML = heading('07','Decisions for us to discuss','Begin with eligible audience and legal structure, then loss priority, valuation and withdrawal rules. The review controls record comments only.') +
    decisions.map(d => detail(d.id,`${d.id} · ${d.title}`,fields([['Working proposal',d.proposal],['Why it matters',d.why]])+`<span class="field-title">Options to evaluate</span><div class="decision-options">${d.options.map(o => `<span>${e(o)}</span>`).join('')}</div>${review(d.id,d.title)}`,d.state)).join('');

  document.querySelector('#acceptance').innerHTML = heading('08','What “working end to end” must prove','Acceptance criteria for the future implementation. Historical receipts support existing mechanics at their recorded source; they do not prove the new product.') +
    detail('release-gates','Product and release gates',acceptance.gates.map(g => detail(`gate-${g.id}`,g.title,fields([['Scope',g.scope],['Evidence today',g.evidence]])+list(g.criteria)+review(`gate-${g.id}`,g.title),g.status)).join('')) +
    detail('acceptance-cases',`${acceptance.cases.length} user and failure scenarios`,acceptance.cases.map(c => detail(`case-${c.id}`,c.title,fields([['Actor',c.actor],['Precondition',c.precondition],['Action',c.action],['Expected result',c.expected],['Failure / recovery',c.failure],['Proof needed',c.proof]])+review(`case-${c.id}`,c.title),c.status)).join(''));

  document.querySelector('#demo').innerHTML = heading('09','Demo scope is a separate choice','Choose the recording scope after validating the product. Test identities can exercise approval states; financial actions still require real signing and verified receipts in the stated test environment.') +
    `<div class="notice">An owner-funded firm flow cannot stand in for capital-provider investment. A no-funds walkthrough is useful product review, but does not prove deposits, shares, repayments or withdrawals.</div>` +
    acceptance.demo.map(d => detail(`demo-${d.id}`,d.title,fields([['Actors',d.actor],['Setup',d.precondition],['Story',d.action],['Required proof',d.proof],['Remaining dependencies',d.blockedBy]])+review(`demo-${d.id}`,d.title),'proposed')).join('');

  const allSources = [...meta.sources,...economics.sources,...compliance.sources,...acceptance.sources,...experience.sources];
  const sources = [...new Map(allSources.map(s => [s.path,s])).values()];
  document.querySelector('#sources').innerHTML = heading('10','Evidence and research','Repository references are pinned to the inspected application checkpoint. External research is historical context, not a verified partner commitment or legal clearance.') +
    `<p class="route">Application checkpoint: ${e(meta.source)}<br>Review branch: ${e(meta.branch)} · Draft ${e(meta.version)} · ${e(meta.date)}</p><ul class="sources">${sources.map(s => `<li>${sourceLink(s)}<span class="fine">${e(s.note)}</span></li>`).join('')}</ul>`;
}

function sourceLink(s) {
  if (/^https:\/\//.test(s.path)) return `<a href="${e(s.path)}" target="_blank" rel="noopener noreferrer">${e(s.title)} ↗</a>`;
  if (s.path.startsWith('../')) return `<strong>${e(s.title)}</strong><br><code class="route">${e(s.path)} (local file, relative to repo root)</code>`;
  const path = s.path.split('/').map(encodeURIComponent).join('/');
  return `<a href="https://github.com/gabrielantonyxaviour/lockgate-open-house/blob/${meta.source}/${path}" target="_blank" rel="noopener noreferrer">${e(s.title)} ↗</a><br><code class="route">${e(s.path)}</code>`;
}

export { features };
