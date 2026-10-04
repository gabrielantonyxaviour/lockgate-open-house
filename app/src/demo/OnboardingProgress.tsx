import { Check, LoaderCircle } from 'lucide-react';
export type OnboardingPhase = 'identity' | 'binding' | 'checking' | 'ready' | 'retry';
export function OnboardingProgress({role,phase,preparing=false,unavailable=false}:{role:'investor'|'provider';phase:OnboardingPhase;preparing?:boolean;unavailable?:boolean}) {
 const identityDone=phase==='checking'||phase==='ready'||phase==='retry';
 const steps=[
  {title:'Wallet',detail:'Connected',done:true,active:false},
  {title:'Identity',detail:identityDone?'Verified':phase==='binding'?'Linking identity…':preparing?'Preparing…':'Verification required',done:identityDone,active:!identityDone},
  {title:role==='investor'?'Positions':'Vehicles',detail:phase==='ready'?(unavailable?'Check unavailable':'Ready'):phase==='checking'?'Checking…':phase==='retry'?'Retry needed':'Not checked yet',done:phase==='ready'&&!unavailable,active:phase==='checking'},
 ];
 return <section className="dg-onboarding-progress" aria-label="Account setup"><h2>Setting up your {role==='investor'?'exit investor':'capital provider'} account</h2><ol aria-live="polite">{steps.map((step,index)=><li key={step.title} data-state={step.done?'complete':step.active?'active':'pending'} aria-current={step.active?'step':undefined}><span className="dg-step-marker">{step.done?<Check size={14}/>:step.active&&(phase==='binding'||phase==='checking'||preparing)?<LoaderCircle size={14} className="dg-spin"/>:index+1}</span><span><strong>{step.title}</strong><small>{step.detail}</small></span></li>)}</ol></section>;
}
