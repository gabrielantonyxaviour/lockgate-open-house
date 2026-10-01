import { z } from "zod";
import { HarnessError } from "./errors.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const actBodySchema = z.object({
  action: z.string().min(1),
  input: z.record(scalar).optional(),
});

export const flagSchema = z.record(z.string());

export function parseActBody(value: unknown): { action: string; input: Record<string, string> } {
  const parsed = actBodySchema.safeParse(value);
  if (!parsed.success) {
    throw new HarnessError("action body is invalid", "VALIDATION");
  }
  const input: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed.data.input ?? {})) input[key] = String(item);
  return { action: parsed.data.action, input };
}

export function parseFlags(value: Record<string, string>): Record<string, string> {
  const parsed = flagSchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("flags are invalid", "VALIDATION");
  return parsed.data;
}
