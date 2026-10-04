import { ArrowLeft, ArrowRight, Check, Download, FileCheck2, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useRef } from "react";
import { useApp } from "../ui/context";
import { canVisit, stepNames, steps } from "./onboarding/steps";
import { StageFields } from "./onboarding/StageFields";
import { usePlan } from "./onboarding/usePlan";
import "../ui/onboarding.css";

export function Onboarding() {
  const { account, connect, preview, snapshot } = useApp();
  const plan = usePlan();
  const heading = useRef<HTMLHeadingElement>(null);
  const allowed = Boolean(account) || preview;
  const meta = steps[plan.step];
  useEffect(() => { heading.current?.focus(); }, [plan.step, plan.complete, allowed]);
  const markers = <span className="plan-corners" aria-hidden="true"><i /><i /><i /><i /></span>;
  if (!allowed) return <div className="plan-onboarding plan-gate" data-slot="onboarding">
    <section className="plan-frame" data-slot="onboarding-frame">
      {markers}<div className="plan-stage">
        <Wallet className="plan-stage-icon" size={24} aria-hidden="true" />
        <header className="plan-heading"><span className="eyebrow">PLATFORM ONBOARDING</span>
          <h1 ref={heading} tabIndex={-1}>Start with your issuer wallet.</h1>
          <p>Connect to prepare a local facility plan for your platform.</p>
        </header>
        <button className="button" onClick={() => void connect()}>Connect issuer wallet <ArrowRight size={14} /></button>
      </div>
    </section>
    <p className="plan-context">Connecting identifies your wallet. It does not submit an application or activate a facility.</p>
  </div>;
  return <div className="plan-onboarding" data-slot="onboarding">
    <div className="plan-progress-region" data-slot="onboarding-progress">
      <div className="plan-progress-meta"><span>Local facility plan</span><span>{plan.complete ? "Plan exported" : `Step ${plan.step + 1} of 5`}</span></div>
      <nav className="plan-progress" aria-label="Application steps">
        {stepNames.map((label, index) => <button type="button" key={label} aria-label={`${index + 1}. ${label}`} title={label}
          disabled={index > plan.step && !canVisit(plan.fields, index)} aria-current={!plan.complete && index === plan.step ? "step" : undefined}
          data-completed={plan.complete || index < plan.step} onClick={() => plan.visit(index)}><span /></button>)}
      </nav>
    </div>
    <section className="plan-frame" data-slot="onboarding-frame">
      {markers}
      {plan.complete ? <div className="plan-stage plan-complete" data-slot="onboarding-complete">
        <div className="plan-success-mark"><FileCheck2 size={28} strokeWidth={1.4} /></div>
        <header className="plan-heading"><h1 ref={heading} tabIndex={-1}>Your plan is exported.</h1>
          <p>{plan.fields.platform} is ready for a conversation about facility terms.</p>
        </header>
        <p className="plan-boundary"><Check size={16} /> A local planning file. No application was submitted and no facility was activated.</p>
        <button className="button secondary" onClick={() => plan.visit(4)}>Review plan <ArrowLeft size={14} /></button>
      </div> : <form id="platform-plan" className="plan-stage" noValidate onSubmit={(event) => { event.preventDefault(); plan.advance(); }}>
        <header className="plan-heading"><span className="eyebrow">PLATFORM ONBOARDING</span>
          <h1 ref={heading} tabIndex={-1}>{meta.title}</h1><p>{meta.description}</p>
        </header>
        <div className="plan-fields" data-slot="onboarding-fields"><StageFields {...plan} /></div>
        <div className="plan-help"><ShieldCheck size={16} aria-hidden="true" /><p>{meta.help}</p></div>
      </form>}
    </section>
    <div className="plan-context">
      <p>Saved only when you choose Save draft. Exporting creates a file, not an application.</p>
      <div className="plan-context-actions"><button type="button" className="inline-link" onClick={plan.discard}>Clear local draft</button>
        {snapshot?.roles.operator && <a className="inline-link" href="#/create">Register an approved platform</a>}
      </div>
    </div>
    <footer className="plan-actions" data-slot="onboarding-actions">
      <div className="plan-actions-inner"><p className="plan-save-status" role="status" aria-live="polite">{plan.message}</p>
        <div className="plan-action-row">
          <button className="button secondary plan-back" type="button" disabled={plan.step === 0 && !plan.complete} onClick={() => plan.visit(plan.complete ? 4 : plan.step - 1)}><ArrowLeft size={14} /> Back</button>
          <div className="plan-forward"><button type="button" className="button secondary" onClick={plan.save}>Save draft</button>
            {plan.complete ? <button className="button" type="button" onClick={plan.exportPlan}><Download size={14} /> Export again</button>
              : <button className="button" type="submit" form="platform-plan" disabled={plan.step === 4 && !plan.valid}>
                {plan.step === 4 ? "Export platform plan" : "Continue"} {plan.step === 4 ? <Download size={14} /> : <ArrowRight size={14} />}
              </button>}
          </div>
        </div>
      </div>
    </footer>
  </div>;
}
