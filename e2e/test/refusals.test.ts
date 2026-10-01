import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { run } from "../../engine/src/cli.ts";
import { EngineError } from "../../engine/src/errors.ts";
import { DEFAULT_PARAMS } from "../../engine/src/pricing/defaults.ts";
import { proposerKey } from "../src/chain.ts";

const quoteSchema = z.object({
  available: z.boolean(),
  feeBps: z.number().int(),
  blocks: z.array(z.object({ code: z.string(), reason: z.string() })),
});

const proposalSchema = z.object({
  submittable: z.boolean(),
  signature: z.string().nullable(),
  blocks: z.array(z.object({ code: z.string(), reason: z.string() })),
});

const now = 1_800_000_000;

test("a gated quote is unavailable and the engine will not sign it", async () => {
  const quote = quoteSchema.parse(await run(["quote", "--file", write("gated", { gated: true })]));
  assert.equal(quote.available, false);
  assert.equal(quote.feeBps, 0);
  assert.ok(quote.blocks.some((block) => block.code === "gated"));
  const signed = proposalSchema.parse(
    await run(["propose", "--file", write("gated-propose", { gated: true }, true), "--sign-env", "LOCKGATE_PROPOSER_KEY"]),
  );
  assert.equal(signed.submittable, false);
  assert.equal(signed.signature, null);
  assert.ok(signed.blocks.some((block) => block.code === "gated"));
});

test("a stale nav is refused and a future nav is a param error", async () => {
  const stale = quoteSchema.parse(
    await run(["quote", "--file", write("stale", { navUpdatedAt: now - 8 * 86_400 })]),
  );
  assert.equal(stale.available, false);
  assert.ok(stale.blocks.some((block) => block.code === "stale-nav"));

  await assert.rejects(run(["quote", "--file", write("future", { navUpdatedAt: now + 60 })]), (err: unknown) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.toJSON().code, "param");
    assert.equal(typeof err.toJSON().error, "string");
    return true;
  });
});

test("an unsigned refusal still parses and is not submittable", async () => {
  const proposal = proposalSchema.parse(await run(["propose", "--file", write("unsigned", { gated: true }, true)]));
  assert.equal(proposal.submittable, false);
  assert.equal(proposal.signature, null);
  assert.ok(proposal.blocks.some((block) => block.code === "gated"));
});

function write(name: string, patch: { gated?: boolean; navUpdatedAt?: number }, propose = false): string {
  const input = {
    platformId: "northwind-invoice",
    kind: "weekly-cycle",
    now,
    navValue: "10000000000",
    queuedAhead: "0",
    cashAvailable: "100000000000",
    cashPerEpoch: "100000000000",
    cashKnown: true,
    gated: patch.gated ?? false,
    navUpdatedAt: patch.navUpdatedAt ?? now - 3_600,
    reserveBalance: "10000000000",
    reserveBps: 750,
    exposure: "0",
    limit: "100000000000",
    bookAssets: "1000000000000",
    utilizationBps: 0,
    repayment: { samples: 8, onTime: 8, late: 0, slashed: 0, gateEvents: 0, windowsObserved: 8 },
    epochStart: now,
    epochSeconds: 600,
    clearingSeconds: 60,
    requestedAt: now,
    requestId: "11",
  };
  const body = propose
    ? {
        input,
        params: { ...DEFAULT_PARAMS, timeScale: 4320 },
        mandate: {
          vault: "0x1111111111111111111111111111111111111111",
          partner: "0x2222222222222222222222222222222222222222",
          signer: "0x2222222222222222222222222222222222222222",
          approvedPlatforms: ["0x3333333333333333333333333333333333333333"],
          platformLimits: { "0x3333333333333333333333333333333333333333": "100000000000" },
          minFeeBps: 25,
          maxTenorSeconds: 30 * 86_400,
          concentrationCapBps: 10_000,
          expiresAt: now + 365 * 86_400,
        },
        platform: "0x3333333333333333333333333333333333333333",
        recipient: "0x3333333333333333333333333333333333333333",
        chainId: 31_337,
        nonce: "1",
      }
    : { input, params: { ...DEFAULT_PARAMS, timeScale: 4320 } };
  const file = `/tmp/lockgate-g9/refusal-${name}.json`;
  process.env.LOCKGATE_PROPOSER_KEY = proposerKey;
  writeFile(file, JSON.stringify(body));
  return file;
}

function writeFile(file: string, contents: string): void {
  mkdirSync("/tmp/lockgate-g9", { recursive: true });
  writeFileSync(file, contents);
}
