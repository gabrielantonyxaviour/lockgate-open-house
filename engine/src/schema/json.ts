import { z } from "zod";

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Drop the empty branch zod emits for bigint. JSON amounts stay a decimal string or a safe integer. */
function closeOpenAmounts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(closeOpenAmounts);
  if (!isPlain(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) next[key] = closeOpenAmounts(child);
  if (!Array.isArray(next.anyOf)) return next;
  next.anyOf = next.anyOf.filter((branch) => !(isPlain(branch) && Object.keys(branch).length === 0));
  return next;
}

/** JSON Schema draft 2020-12 for a zod document. */
export function publishJsonSchema(schema: z.ZodType, id: string): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return { ...(closeOpenAmounts(json) as Record<string, unknown>), $id: id };
}

/** True when `value` satisfies the published document. This is the canonical file shape, including `schemaVersion`. */
export function matchesJsonSchema(schema: Record<string, unknown>, value: unknown): boolean {
  return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(value).success;
}
