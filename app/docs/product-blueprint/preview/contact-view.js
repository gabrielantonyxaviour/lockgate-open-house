// Public contact verified in site/src/content.ts. This module never sends email.
const contact = {
  originator: {label:'Originating fund / platform',title:'Let’s discuss your investor exits.',description:'Tell us about your organization, the assets you originate and how investor ownership is recorded.',subject:'Lockgate — originating fund / platform enquiry',topics:['Organization and jurisdiction','Asset type and ownership register','Investor exit and settlement needs']},
  manager: {label:'Licensed investment firm',title:'Let’s discuss your firm’s mandate.',description:'Tell us about your firm, its permitted investment activities and the capital vehicle you manage.',subject:'Lockgate — investment firm enquiry',topics:['Firm and jurisdiction','Licensed activity and mandate','Vehicle and underwriting requirements']},
};
export function contactView(role){
  const c=contact[role];
  const body=`Hello Lockgate,\n\nI’d like to discuss ${role==='originator'?'enabling investor exits for our organization':'our firm’s participation'}.\n\n${c.topics.map(t=>t+': ').join('\n')}\n\nThank you.`;
  const href=`mailto:gabriel@lockgate.finance?subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(body)}`;
  return `<section class="contact-entry narrow" aria-labelledby="contact-heading">
    <button class="button back-link" data-action="public">← All roles</button>
    <div class="page-heading"><span class="eyebrow">${c.label}</span><h1 id="contact-heading" tabindex="-1">${c.title}</h1><p>${c.description}</p></div>
    <div class="panel contact-panel"><h2>A conversation before onboarding</h2><p>We’ll discuss the fit and requirements before any invitation to onboard.</p>
      <ul class="contact-topics">${c.topics.map(t=>`<li>${t}</li>`).join('')}</ul>
      <a class="button primary contact-link" href="${href}">Email Lockgate <span aria-hidden="true">↗</span></a>
      <p class="contact-address">gabriel@lockgate.finance</p>
      <p class="contact-note">Opens an email draft. Nothing is sent by this preview.</p>
    </div>
  </section>`;
}
export function contactInspector(role){
  return `<section class="inspector" aria-label="Contact entry inspector"><div class="inspector-heading"><div><span class="eyebrow">Outside the product / Entry contract</span><h2>${contact[role].label} · Contact first</h2></div><span class="badge">Local review</span></div>
    <div class="inspector-grid"><div><h3>Entry behavior</h3><p>Talk to us opens this contact entry. Email Lockgate uses the existing public mailbox and a role-specific draft. It does not submit an application.</p></div><div><h3>Permission & postcondition</h3><p>No wallet connection, authenticated profile, enquiry receipt, invitation or activation is created. Sending remains a separate action in the visitor’s email client.</p></div><div><h3>Reviewer access</h3><p>The role controls above retain the full proposed journeys for review. They are not public self-service institutional onboarding. Wallet-first routing remains a written contract outside this card change.</p></div></div>
  </section>`;
}
