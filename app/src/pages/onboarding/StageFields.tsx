import { Select } from "../../ui/Select";
import type { DraftFields } from "../../ui/drafts";

const fieldNames: Record<keyof DraftFields, string> = { company: "Entity", platform: "Platform", issuer: "Issuer wallet", limit: "Limit · USDG", tenor: "Tenor · days", reserve: "Reserve · USDG", integration: "Redemption model" };
const models = [{ value: "weekly", label: "Weekly queue" }, { value: "epoch", label: "Epoch settlement" }, { value: "quarterly", label: "Quarterly window" }];
export function StageFields({ fields, step, attempted, issue, edit, visit }: {
  fields: DraftFields; step: number; attempted: boolean; issue: (key: keyof DraftFields) => string;
  edit: (key: keyof DraftFields, value: string) => void; visit: (step: number) => void;
}) {
  const input = (key: keyof DraftFields, label: string, help: string, placeholder: string) => {
    const error = attempted ? issue(key) : "";
    return <label className="field" key={key} htmlFor={`plan-${key}`}>
      {label}
      <input id={`plan-${key}`} name={key} value={fields[key]} onChange={(event) => edit(key, event.target.value)}
        maxLength={key === "issuer" ? 42 : key === "company" || key === "platform" ? 120 : key === "tenor" ? 8 : 24}
        placeholder={placeholder} inputMode={["limit", "reserve", "tenor"].includes(key) ? "decimal" : "text"}
        aria-invalid={Boolean(error)} aria-describedby={`help-${key}${error ? ` error-${key}` : ""}`} />
      <small id={`help-${key}`} className="muted">{help}</small>
      {error && <small id={`error-${key}`} className="plan-field-error">{error}</small>}
    </label>;
  };
  if (step === 0) return <>
    {input("company", "Legal entity name", "The corporation proposing the facility.", "Company name")}
    {input("platform", "Platform name", "The name investors would recognize.", "Platform name")}
    {input("issuer", "Issuer wallet", "Public EVM address only. Never a private key.", "0x…")}
  </>;
  if (step === 1) return <>
    {input("limit", "Requested facility limit · USDG", "Planning capacity; not an approved credit line.", "1000")}
    {input("tenor", "Target repayment tenor · days", "Use 1–3,650 days. Settlement windows are configured separately.", "30")}
  </>;
  if (step === 2) return input("reserve", "Planned platform reserve · USDG", "A positive amount within your requested facility limit.", "75");
  if (step === 3) return <label className="field">Redemption model
    <Select label="Redemption model" value={fields.integration} onValueChange={(value) => edit("integration", value)} options={models} />
    <small className="muted">Platform creation is restricted to the factory owner. A saved plan cannot create a contract.</small>
  </label>;
  return <div className="plan-review">
    <dl className="key-values">
      {Object.entries(fields).map(([key, value]) => <div key={key}><dt>{fieldNames[key as keyof DraftFields]}</dt>
        <dd className={key === "issuer" ? "mono" : ""}>{key === "integration" ? models.find((model) => model.value === value)?.label : value || "Not entered"}</dd>
      </div>)}
    </dl>
    <div className="plan-review-links">{["Platform details", "Facility terms", "Reserve plan", "Integration"].map((label, index) =>
      <button className="inline-link" type="button" key={label} onClick={() => visit(index)}>Edit {label.toLowerCase()}</button>)}</div>
  </div>;
}
