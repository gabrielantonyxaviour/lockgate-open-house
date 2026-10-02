import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { explain, type Ctx } from "./chain.js";
import { HarnessError } from "./errors.js";

const ORDER = ["stage1", "door2", "stage2", "stage3"] as const;
export type StepId = (typeof ORDER)[number];

const stepSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/),
  blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  result: z.unknown(),
});

const fileSchema = z.object({
  chainId: z.number().int(),
  factory: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  steps: z.record(stepSchema),
});

type Cursor = z.infer<typeof fileSchema>;
type Step = z.infer<typeof stepSchema>;

export function cursorPath(manifestFile: string): string {
  return manifestFile.replace(/\.json$/, ".demo.json");
}

function isStep(id: string): id is StepId {
  return (ORDER as readonly string[]).includes(id);
}

function blank(ctx: Ctx): Cursor {
  return { chainId: ctx.chainId, factory: ctx.manifest.factory, steps: {} };
}

async function hashMatches(ctx: Ctx, step: Step): Promise<boolean> {
  try {
    const block = await ctx.publicClient.getBlock({ blockNumber: BigInt(step.blockNumber) });
    return (block.hash ?? "").toLowerCase() === step.blockHash.toLowerCase();
  } catch {
    return false;
  }
}

/** A missing earlier step, or a block that is not on this chain, drops that step and every later one. */
async function load(ctx: Ctx): Promise<Cursor> {
  if (!ctx.manifestFile) return blank(ctx);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(cursorPath(ctx.manifestFile), "utf8"));
  } catch {
    return blank(ctx);
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) return blank(ctx);
  if (parsed.data.chainId !== ctx.chainId) return blank(ctx);
  if (parsed.data.factory.toLowerCase() !== ctx.manifest.factory.toLowerCase()) return blank(ctx);
  const steps: Cursor["steps"] = {};
  for (const id of ORDER) {
    const step = parsed.data.steps[id];
    if (!step || !(await hashMatches(ctx, step))) break;
    steps[id] = step;
  }
  return { chainId: parsed.data.chainId, factory: parsed.data.factory, steps };
}

function write(ctx: Ctx, cursor: Cursor): void {
  if (!ctx.manifestFile) return;
  const path = cursorPath(ctx.manifestFile);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cursor, null, 2)}\n`);
  renameSync(tmp, path);
}

/** A wiped Anvil still has the manifest file. Refuse to run a step against addresses with no code. */
async function assertPresent(ctx: Ctx): Promise<void> {
  if (Object.keys(ctx.manifest.contracts).length === 0) return;
  let code: string | undefined;
  try {
    code = await ctx.publicClient.getBytecode({ address: ctx.manifest.factory as `0x${string}` });
  } catch (err) {
    throw explain(err);
  }
  if (!code || code === "0x") throw new HarnessError("Manifest contracts are not on this chain", "NOT_DEPLOYED");
}

function jsonResult(result: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(result)) as unknown;
  } catch {
    throw new HarnessError("Demo result is not JSON", "VALIDATION");
  }
}

/** Re-reads the cursor on every call. A saved step whose block is still on this chain is not run again. */
export async function runStep(ctx: Ctx, id: string, fn: () => Promise<unknown>): Promise<unknown> {
  if (!isStep(id)) throw new HarnessError("Unknown demo step", "VALIDATION");
  if (!ctx.manifestFile) return fn();
  const saved = (await load(ctx)).steps[id];
  if (saved) return saved.result;
  await assertPresent(ctx);
  const result = jsonResult(await fn());
  const block = await ctx.publicClient.getBlock();
  if (!block.hash) throw new HarnessError("Block hash is missing", "ASSERTION");
  const fresh = await load(ctx);
  fresh.steps[id] = { blockNumber: block.number.toString(), blockHash: block.hash, result };
  write(ctx, fresh);
  return result;
}
