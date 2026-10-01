import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { fail, publicClient } from "./chain.js";
import { runStage1 } from "./stage1.js";
import { runStage2 } from "./stage2.js";
import { runStage3 } from "./stage3.js";

const resultSchema = z.object({
  chainId: z.literal(31_337),
  block: z.number().int().nonnegative(),
  stage1: z.object({
    chainFeeBps: z.number().int(),
    engineFeeBps: z.number().int().min(25).max(1500),
    fee: z.string(),
    investorPaid: z.string(),
    outstanding: z.literal("0"),
    earnedFees: z.string(),
    line: z.string(),
  }),
  stage2: z.object({
    source: z.string(),
    engineSignatureAccepted: z.literal(true),
    harbourFeeBps: z.number().int().min(25).max(1500),
    keppelFeeBps: z.number().int().min(25).max(1500),
    harbourRepaid: z.string(),
    keppelOutstanding: z.string(),
    routerBalance: z.literal("0"),
    lockgateBalance: z.literal("0"),
  }),
  stage3: z.object({
    availableDraw: z.string(),
    seniorAfterLoss: z.string(),
    juniorAfterLoss: z.literal("0"),
    cash: z.string(),
    engineFeeBps: z.number().int(),
    engineAvailable: z.boolean(),
    creditLineBookMatches: z.literal(true),
  }),
});

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 31_337) fail("chain", `refusing chain ${chainId}`);
  const block = await publicClient.getBlock();
  const now = Number(block.timestamp);
  const stage1 = await runStage1(now);
  const stage2 = await runStage2(now);
  const stage3 = await runStage3(now, stage1.line as `0x${string}`);
  const result = resultSchema.parse({
    chainId,
    block: Number(block.number),
    stage1: { ...stage1, chainFeeBps: Number(stage1.chainFeeBps) },
    stage2,
    stage3,
  });
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output.json");
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, file })}\n`);
}

main().catch((err: { message?: string; code?: string }) => {
  process.stderr.write(`${JSON.stringify({ error: err?.message ?? "e2e failed", code: err?.code ?? "e2e" })}\n`);
  process.exit(1);
});
