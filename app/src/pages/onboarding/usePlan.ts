import { useState } from "react";
import { clearDraft, emptyDraft, loadDraft, readyDraft, saveDraft, type DraftFields } from "../../ui/drafts";
import { canVisit, stepFields } from "./steps";

export function usePlan() {
  const [initial] = useState(() => {
    try { return loadDraft(window.localStorage); } catch { return null; }
  });
  const [fields, setFields] = useState<DraftFields>(initial?.fields ?? { ...emptyDraft });
  const [step, setStep] = useState(() => canVisit(initial?.fields ?? emptyDraft, initial?.step ?? 0) ? initial?.step ?? 0 : 0);
  const [message, setMessage] = useState(initial ? "Saved draft restored from this device." : "No draft saved yet.");
  const [attempted, setAttempted] = useState(false);
  const [complete, setComplete] = useState(false);
  const validation = readyDraft.safeParse(fields);
  const issue = (key: keyof DraftFields) => validation.success ? "" : validation.error.issues.find((item) => item.path[0] === key)?.message || "";
  const edit = (key: keyof DraftFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setMessage("Unsaved changes");
  };
  const visit = (destination: number) => {
    if (!canVisit(fields, destination)) return;
    setStep(destination); setAttempted(false); setComplete(false);
  };
  const save = () => {
    try { setMessage(saveDraft(window.localStorage, fields, step) ? "Draft saved on this device." : "Could not save. Browser storage may be unavailable."); }
    catch { setMessage("Could not save. Browser storage may be unavailable."); }
  };
  const exportPlan = () => {
    if (!validation.success) {
      setMessage("Resolve the required fields before exporting."); setAttempted(true); return;
    }
    const blob = new Blob([JSON.stringify({ version: 1, status: "draft", network: "Arbitrum Sepolia", ...validation.data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "lockgate-platform-plan.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Plan exported. No application was submitted."); setComplete(true);
  };
  const advance = () => {
    if (step === 4) { exportPlan(); return; }
    if (!canVisit(fields, step + 1)) {
      setAttempted(true); setMessage("Complete the required fields for this step before continuing.");
      const invalid = stepFields[step].find((key) => issue(key));
      requestAnimationFrame(() => document.getElementById(`plan-${invalid}`)?.focus());
      return;
    }
    visit(step + 1);
  };
  const discard = () => {
    try {
      if (!clearDraft(window.localStorage)) { setMessage("Could not remove the saved draft."); return; }
      setFields({ ...emptyDraft }); setStep(0); setAttempted(false); setComplete(false); setMessage("Local draft cleared.");
    } catch { setMessage("Could not remove the saved draft."); }
  };
  return { fields, step, message, attempted, complete, valid: validation.success, issue, edit, visit, save, advance, exportPlan, discard };
}
