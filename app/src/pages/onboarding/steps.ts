import { readyDraft, type DraftFields } from "../../ui/drafts";

export const steps = [
  { title: "Platform details", description: "Tell us which platform this facility is for.", help: "Use your legal entity and a public issuer wallet address. You can edit every detail before exporting." },
  { title: "Facility terms", description: "Set the capacity and repayment horizon you want to plan for.", help: "These are planning amounts. Pricing, capacity, and repayment terms require agreement before activation." },
  { title: "Reserve plan", description: "Plan the USDG buffer behind your platform’s facility.", help: "A reserve absorbs losses only up to its available balance. Funding and release permissions must be agreed before activation." },
  { title: "Integration", description: "Choose the redemption model your platform uses.", help: "The integration must quote exits, draw the facility, pay investors, and repay Lockgate before the remaining queue." },
  { title: "Review your plan", description: "Check the details before exporting your local facility draft.", help: "Activation requires agreed terms, funded reserves, a tested integration, and owner-authorized deployment." },
];
export const stepNames = ["Platform details", "Facility terms", "Reserve plan", "Integration", "Review"];
export const stepFields: (keyof DraftFields)[][] = [["company", "platform", "issuer"], ["limit", "tenor"], ["reserve"], ["integration"], []];
export function canVisit(fields: DraftFields, destination: number) {
  const result = readyDraft.safeParse(fields);
  return result.success || !result.error.issues.some((issue) =>
    stepFields.slice(0, destination).flat().includes(issue.path[0] as keyof DraftFields));
}
