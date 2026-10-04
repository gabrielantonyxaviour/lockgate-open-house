const paths = {
  investor: '<path d="M5 17 17 5M7 5h10v10"/><path d="M5 9v10h10"/>',
  originator: '<path d="M4 20h16M6 20V8l6-4 6 4v12M9 11h6M9 15h6"/>',
  manager: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V5h6v3M4 13h16M10 13v3h4v-3"/>',
  provider: '<path d="m12 3 9 9-9 9-9-9 9-9ZM8 12h8M12 8v8"/>',
};
const entries = [
  {id:'investor',title:'Exit investor',description:'Explore an earlier payout from an investment you already hold.',cta:'Get Started'},
  {id:'originator',title:'Originating fund / platform',description:'Discuss connecting your assets and enabling earlier investor exits.',cta:'Talk to us'},
  {id:'manager',title:'Licensed investment firm',description:'Discuss your mandate and a managed onboarding for your firm.',cta:'Talk to us'},
  {id:'provider',title:'Capital provider',description:'Explore approved vehicles and invest through an eligible firm.',cta:'Get Started'},
];
export function entryCards(){
  return `<div class="welcome">
    <h1 tabindex="-1">Choose your path.</h1>
    <p class="welcome-copy">Get started, or talk with our team.</p>
    <div class="task-grid">
      ${entries.map((entry,i)=>`<article class="task-card" aria-labelledby="entry-${entry.id}">
        <div class="task-card-top"><span class="task-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[entry.id]}</svg></span><span class="task-number">0${i+1}</span></div>
        <h2 id="entry-${entry.id}">${entry.title}</h2>
        <p>${entry.description}</p>
        <button class="button primary task-cta" data-action="${entry.cta==='Talk to us'?'contact':'role'}" data-value="${entry.id}" aria-label="${entry.cta} — ${entry.title}"><span>${entry.cta}</span><span aria-hidden="true">↗</span></button>
      </article>`).join('')}
    </div>
    <div class="welcome-note"><b>Institutions begin with a conversation.</b><span>Fund and firm onboarding follows a reviewed invitation.</span></div>
  </div>`;
}
