import { z } from "zod";
import { HarnessError } from "./errors.js";

export const actBodySchema = z.object({
  action: z.string().min(1).max(64),
  input: z.record(z.string().max(256)).optional(),
});

export const flagSchema = z.record(z.string());

export function parseActBody(value: unknown): { action: string; input: Record<string, string> } {
  const parsed = actBodySchema.safeParse(value);
  if (!parsed.success) {
    throw new HarnessError("action body is invalid", "VALIDATION");
  }
  return { action: parsed.data.action, input: parsed.data.input ?? {} };
}

export function parseFlags(value: Record<string, string>): Record<string, string> {
  const parsed = flagSchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("flags are invalid", "VALIDATION");
  return parsed.data;
}
