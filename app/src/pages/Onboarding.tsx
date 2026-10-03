import { Select } from "../ui/Select";
import { useState } from "react";
import { Badge, PageHead, Panel } from "../ui/primitives";
import { clearDraft, emptyDraft, loadDraft, readyDraft, saveDraft, type DraftFields } from "../ui/drafts";

const steps = ["Platform details", "Facility terms", "Reserve plan", "Integration", "Review"];
const stepFields: (keyof DraftFields)[][] = [
  ["company", "platform", "issuer"],
  ["limit", "tenor"],
  ["reserve"],
  ["integration"],
  [],
];
function canVisit(fields: DraftFields, destination: number) {
  const result = readyDraft.safeParse(fields);
  return (
    result.success ||
    !result.error.issues.some((issue) =>
      stepFields
        .slice(0, destination)
        .flat()
        .includes(issue.path[0] as keyof DraftFields),
    )
  );
}
export function Onboarding() {
  const [initial] = useState(() => {
    try {
      return loadDraft(window.localStorage);
    } catch {
      return null;
    }
  });
  const [fields, setFields] = useState<DraftFields>(initial?.fields ?? { ...emptyDraft });
  const [step, setStep] = useState(() => {
    const target = initial?.step ?? 0;
    return canVisit(initial?.fields ?? emptyDraft, target) ? target : 0;
  });
  const [message, setMessage] = useState("");
  const validation = readyDraft.safeParse(fields);
  const issue = (key: keyof DraftFields) =>
    validation.success ? "" : validation.error.issues.find((item) => item.path[0] === key)?.message;
  const edit = (key: keyof DraftFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setMessage("Unsaved changes");
  };
  const nextStep = () => {
    if (!canVisit(fields, step + 1)) {
      setMessage("Complete the required fields for this step before continuing.");
      return;
    }
    setStep((value) => value + 1);
    setMessage("");
  };
  const input = (key: keyof DraftFields, label: string, help: string, placeholder: string) => (
    <label className="field" key={key}>
      {label}
      <input
        value={fields[key]}
        onChange={(event) => edit(key, event.target.value)}
        maxLength={key === "issuer" ? 42 : key === "company" || key === "platform" ? 120 : 24}
        placeholder={placeholder}
        inputMode={["limit", "reserve", "tenor"].includes(key) ? "decimal" : "text"}
        aria-describedby={`help-${key}`}
      />
      <small id={`help-${key}`} className="muted">
        {help}
      </small>
    </label>
  );
  const save = () => {
    try {
      setMessage(
        saveDraft(window.localStorage, fields, step)
          ? "Draft saved on this device."
          : "Could not save. Browser storage may be unavailable.",
      );
    } catch {
      setMessage("Could not save. Browser storage may be unavailable.");
    }
  };
  const exportPlan = () => {
    if (!validation.success) {
      setMessage("Resolve the readiness checklist before exporting.");
      return;
    }
    const blob = new Blob(
      [JSON.stringify({ version: 1, status: "draft", network: "Arbitrum Sepolia", ...validation.data }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lockgate-platform-plan.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Plan exported. No application was submitted.");
  };
  const discard = () => {
    try {
      if (!clearDraft(window.localStorage)) {
        setMessage("Could not remove the saved draft.");
        return;
      }
      setFields({ ...emptyDraft });
      setStep(0);
      setMessage("Local draft cleared.");
    } catch {
      setMessage("Could not remove the saved draft.");
    }
  };
  return (
    <div className="stack onboarding-content">
      <PageHead
        eyebrow="PLATFORM ONBOARDING"
        title="Plan your exit facility."
        description="Prepare the commercial and integration details for a platform facility."
        action={<Badge>Local draft</Badge>}
      />
      <a className="inline-link" href="#/create">Operator? Register an approved platform.</a>
      <div className="notice">
        Saved on this device until you export. This draft does not submit an application or activate a facility.
      </div>
      <nav className="stepper" aria-label="Application steps">
        {steps.map((label, index) => (
          <button
            className={`button secondary ${index === step ? "active" : ""}`}
            key={label}
            disabled={index > step && !canVisit(fields, index)}
            aria-current={index === step ? "step" : undefined}
            onClick={() => setStep(index)}
          >
            {index + 1}. {label}
          </button>
        ))}
      </nav>
      <div className="grid-two">
        <Panel eyebrow={`STEP ${step + 1} OF 5`} title={steps[step]}>
          <div className="stack">
            {step === 0 && (
              <>
                {input("company", "Legal entity name", "The corporation proposing the facility.", "Company name")}
                {input("platform", "Platform name", "The name investors would recognize.", "Platform name")}
                {input("issuer", "Issuer wallet", "Public EVM address only. Never a private key.", "0x…")}
              </>
            )}
            {step === 1 && (
              <>
                {input(
                  "limit",
                  "Requested facility limit · USDG",
                  "A planning amount; capacity requires an approved facility.",
                  "1000",
                )}
                {input(
                  "tenor",
                  "Target repayment tenor · days",
                  "Use 1–3,650 days. Window timing is configured separately.",
                  "30",
                )}
                <p className="muted">
                  Pricing, repayment priority, and platform eligibility require agreed facility terms. This form does not set
                  contract parameters.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                {input(
                  "reserve",
                  "Planned platform reserve · USDG",
                  "Reserve can absorb losses only up to its available balance.",
                  "75",
                )}
                <div className="notice">
                  A reserve is a limited buffer. It does not guarantee repayment of the entire facility.
                </div>
                <p className="muted">Reserve funding and release permissions must be agreed before activation.</p>
              </>
            )}
            {step === 3 && (
              <>
                <label className="field">
                  Redemption model
                  <Select
                    label="Redemption model"
                    value={fields.integration}
                    onValueChange={(value) => edit("integration", value)}
                    options={[
                      { value: "weekly", label: "Weekly queue" },
                      { value: "epoch", label: "Epoch settlement" },
                      { value: "quarterly", label: "Quarterly window" },
                    ]}
                  />
                </label>
                <p>
                  Integrate a platform that can quote an exit, draw its facility, pay the investor, and repay Lockgate before
                  processing the remaining redemption queue.
                </p>
                <div className="notice">
                  Platform creation is restricted to the factory owner. A saved plan cannot create a contract.
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <dl className="key-values">
                  {Object.entries(fields).map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {
                          {
                            company: "Entity",
                            platform: "Platform",
                            issuer: "Issuer wallet",
                            limit: "Limit · USDG",
                            tenor: "Tenor · days",
                            reserve: "Reserve · USDG",
                            integration: "Redemption model",
                          }[key]
                        }
                      </dt>
                      <dd className={key === "issuer" ? "mono" : ""}>{value || "Not entered"}</dd>
                    </div>
                  ))}
                </dl>
                <button className="button" disabled={!validation.success} onClick={exportPlan}>
                  Export platform plan
                </button>
              </>
            )}
            <div className="row">
              <button className="button secondary" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>
                Back
              </button>
              {step < 4 && (
                <button className="button" onClick={nextStep}>
                  Continue
                </button>
              )}
              <button className="button secondary" onClick={save}>
                Save draft
              </button>
            </div>
            <p role="status" aria-live="polite" className="muted">
              {message || (initial ? "Saved draft restored from this device." : "No draft saved yet.")}
            </p>
          </div>
        </Panel>
        <div className="stack">
          <Panel title="Readiness checklist">
            <div className="stack">
              {(["company", "platform", "issuer", "limit", "tenor", "reserve"] as const).map((key) => (
                <div className="readiness-row" key={key}>
                  <Badge tone={issue(key) ? "warn" : "good"}>{issue(key) ? "Needed" : "Entered"}</Badge>
                  <span>
                    {issue(key) ||
                      {
                        company: "Entity name",
                        platform: "Platform name",
                        issuer: "Issuer wallet",
                        limit: "Facility limit",
                        tenor: "Repayment tenor",
                        reserve: "Reserve plan",
                      }[key]}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Before activation">
            <p>
              Activation requires agreed terms, funded reserves, a tested integration, and owner-authorized deployment.
            </p>
            <button className="button secondary" onClick={discard}>
              Clear local draft
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
