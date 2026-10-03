import { z } from "zod";

export const DRAFT_KEY = "lockgate.platform-draft.v1";
const text = z.string().max(120);
export const draftFields = z
  .object({
    company: text,
    platform: text,
    issuer: z.string().max(42),
    limit: z.string().max(24),
    tenor: z.string().max(8),
    reserve: z.string().max(24),
    integration: z.enum(["weekly", "epoch", "quarterly"]),
  })
  .strict();
export type DraftFields = z.infer<typeof draftFields>;
export const emptyDraft: DraftFields = {
  company: "",
  platform: "",
  issuer: "",
  limit: "",
  tenor: "",
  reserve: "",
  integration: "weekly",
};
const positiveAmount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter a positive amount with at most six decimals.")
  .refine((value) => Number(value) > 0, "Amount must be greater than zero.");
export const readyDraft = draftFields
  .extend({
    company: text.trim().min(2, "Enter the legal entity name."),
    platform: text.trim().min(2, "Enter the platform name."),
    issuer: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid issuer wallet address."),
    limit: positiveAmount,
    tenor: z
      .string()
      .regex(/^\d{1,4}$/, "Enter a whole number of days.")
      .refine((value) => Number(value) >= 1 && Number(value) <= 3650, "Use 1–3,650 days."),
    reserve: positiveAmount,
  })
  .refine((value) => Number(value.reserve) <= Number(value.limit), {
    path: ["reserve"],
    message: "Planned reserve cannot exceed the requested facility limit.",
  });
const storedDraft = z
  .object({
    version: z.literal(1),
    step: z.number().int().min(0).max(4),
    fields: draftFields,
    savedAt: z.number().int().nonnegative().max(8.64e15),
  })
  .strict();
export type SavedDraft = z.infer<typeof storedDraft>;
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadDraft(storage: DraftStorage): SavedDraft | null {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw || raw.length > 4096) return null;
    const parsed = storedDraft.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function saveDraft(storage: DraftStorage, fields: DraftFields, step: number): boolean {
  const parsed = storedDraft.safeParse({ version: 1, step, fields, savedAt: Date.now() });
  if (!parsed.success) return false;
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}
export function clearDraft(storage: DraftStorage): boolean {
  try {
    storage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}
