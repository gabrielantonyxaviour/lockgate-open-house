import {escape,button,rows} from './ui.js';
// Public mailbox comes from site/src/content.ts. No request or email is sent here.
const contact={
 originator:{label:'Originating fund / platform',title:'Let’s discuss your investor exits.',details:'Asset type and investor exit needs',hint:'Describe the assets, ownership register and settlement needs.'},
 manager:{label:'Licensed investment firm',title:'Let’s discuss your firm’s mandate.',details:'Mandate and investment scope',hint:'Describe your permitted activities, vehicle and underwriting mandate.'},
};
export const newEnquiry=()=>({values:{name:'',email:'',organization:'',jurisdiction:'',details:''},errors:{},stage:'form'});
export function validateEnquiry(values){
 const errors={};
 for(const [key,label,max] of [['name','representative name',100],['organization','organization',160],['jurisdiction','jurisdiction',80],['details','short details',1200]]){
  if(values[key].trim().length<2)errors[key]=`Enter your ${label}.`;
  else if(values[key].length>max)errors[key]=`Keep this field under ${max} characters.`;
 }
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())||values.email.length>254)errors.email='Enter a valid work email address.';
 return errors;
}
const reference=role=>`PREVIEW-${role==='originator'?'FUND':'FIRM'}-0001`;
function input(key,label,draft,{type='text',max=100,hint=''}={}){
 const error=draft.errors[key];
 return `<div class="enquiry-field ${key==='details'?'full-field':''}"><label for="enquiry-${key}">${label}</label>${key==='details'?`<textarea id="enquiry-${key}" name="${key}" rows="3" maxlength="${max}" required aria-describedby="${key}-hint ${key}-error" ${error?'aria-invalid="true"':''}>${escape(draft.values[key])}</textarea>`:`<input id="enquiry-${key}" name="${key}" type="${type}" value="${escape(draft.values[key])}" maxlength="${max}" required autocomplete="${{name:'name',email:'email',organization:'organization',jurisdiction:'country-name'}[key]||'off'}" aria-describedby="${key}-hint ${key}-error" ${error?'aria-invalid="true"':''}>`}<span class="enquiry-hint" id="${key}-hint">${hint}</span><span class="enquiry-error" id="${key}-error">${error||''}</span></div>`;
}
export function contactView(role,draft){
 const c=contact[role];
 if(draft.stage==='email')return acknowledgement(role,draft);
 if(draft.stage==='review')return reviewEnquiry(role,draft);
 return `<section class="contact-entry narrow" aria-labelledby="contact-heading"><button class="button back-link" data-action="public">← All roles</button><div class="page-heading"><span class="eyebrow">${c.label}</span><h1 id="contact-heading" tabindex="-1">${c.title}</h1><p>A few details help us understand the fit before onboarding.</p></div>
  <form id="enquiry-form" class="panel enquiry-form" novalidate>${Object.keys(draft.errors).length?'<p class="enquiry-error-summary" role="alert">Check the highlighted fields. Your draft is preserved.</p>':''}<div class="enquiry-fields">${input('name','Representative name',draft)}${input('email','Work email',draft,{type:'email',max:254})}${input('organization','Organization',draft,{max:160})}${input('jurisdiction','Jurisdiction',draft,{max:80})}${input('details',c.details,draft,{max:1200,hint:c.hint})}</div>
  <p class="enquiry-privacy">Please don’t include identity documents or confidential investor information.</p><p class="enquiry-review-note">Local review only. These details stay in this page and are not submitted.</p><button type="submit" class="button primary">Review enquiry</button></form><p class="contact-reference">Public contact: <a href="mailto:gabriel@lockgate.finance">gabriel@lockgate.finance</a></p></section>`;
}
function reviewEnquiry(role,draft){
 const c=contact[role],v=draft.values;
 return `<section class="contact-entry narrow"><button class="button back-link" data-action="enquiry-edit">← Edit details</button><div class="page-heading"><span class="eyebrow">${c.label}</span><h1 tabindex="-1">Review your enquiry.</h1><p>Check the details before viewing the proposed acknowledgement.</p></div><div class="panel enquiry-review">${rows([['Representative',escape(v.name)],['Work email',escape(v.email)],['Organization',escape(v.organization)],['Jurisdiction',escape(v.jurisdiction)]])}<h2>${c.details}</h2><p class="enquiry-details">${escape(v.details)}</p><div class="notice"><span class="notice-mark">i</span><div><strong>Nothing has been submitted</strong><p>The next screen previews the acknowledgement email. It does not create a request, send an email or invite your organization.</p></div></div><div class="actions">${button('Preview acknowledgement','enquiry-email')}${button('Edit enquiry','enquiry-edit','secondary')}</div></div></section>`;
}
function acknowledgement(role,draft){
 const v=draft.values,ref=reference(role);
 return `<section class="acknowledgement"><button class="button back-link" data-action="enquiry-review">← Back to enquiry</button><div class="page-heading"><span class="eyebrow">Transactional email / Review only</span><h1 tabindex="-1">Acknowledgement preview.</h1><p>Nothing was submitted or sent. The intended email below confirms receipt only, not approval.</p></div><div class="email-envelope"><span><b>To</b> ${escape(v.name)} &lt;${escape(v.email)}&gt;</span><span><b>Subject</b> We’ve received your Lockgate enquiry · ${ref}</span><span class="badge amber">PREVIEW · Not sent or delivered</span></div>
  <article class="email-preview" aria-label="Branded acknowledgement email preview"><div class="email-brand"><img src="/mark.svg" width="28" height="28" alt="">lockgate<span>.</span></div><p class="email-eyebrow">THANK YOU FOR GETTING IN TOUCH</p><h2>We’ve received your enquiry.</h2><p>Hello ${escape(v.name)},</p><p>Thank you for contacting Lockgate on behalf of <strong>${escape(v.organization)}</strong>. We’ve received your ${role==='originator'?'fund or platform':'investment firm'} enquiry.</p><div class="email-reference"><span>Your enquiry reference</span><strong>${ref}</strong></div><h3>What happens next</h3><p>Our team will review your ${role==='originator'?'asset and investor exit requirements':'mandate and investment scope'} and contact you to discuss the fit. If appropriate, we’ll share the requirements and an invitation to managed onboarding.</p><p>This acknowledgement is not onboarding acceptance, partnership approval or activation.</p><p>Questions or updates? Contact <a href="mailto:gabriel@lockgate.finance">gabriel@lockgate.finance</a> and include your reference.</p><div class="email-signoff">The Lockgate team</div><footer>Lockgate · Institutional enquiries</footer></article><div class="actions">${button('Edit enquiry','enquiry-edit','secondary')}${button('Return to all roles','public','secondary')}</div></section>`;
}
export function contactInspector(role){
 return `<section class="inspector" aria-label="Contact entry inspector"><div class="inspector-heading"><div><span class="eyebrow">Outside the product / Entry contract</span><h2>${contact[role].label} · Managed enquiry</h2></div><span class="badge">Local review</span></div><div class="inspector-grid"><div><h3>Form and draft</h3><p>Required fields validate locally. Errors focus the first invalid field; draft values survive edits and navigation in this page. No identity documents are requested. Reload clears these in-memory drafts.</p></div><div><h3>Acknowledgement boundary</h3><p>The reference begins PREVIEW. The branded HTML email is addressed to the entered email but no request is persisted, queued, sent or delivered. Production must first persist an enquiry, then queue idempotent transactional email from a verified domain.</p></div><div><h3>Permissions and next steps</h3><p>Receipt acknowledgement never grants a partnership, invitation, account, eligibility or activation. Full institutional reviewer journeys remain available above. Public contact is the established gabriel@lockgate.finance mailbox.</p></div></div></section>`;
}
