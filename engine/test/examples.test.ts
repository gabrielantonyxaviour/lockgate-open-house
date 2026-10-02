import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_CHAIN_IDS } from "../src/chains.js";
import { proposeBodySchema } from "../src/cli-check.js";
import { parseOrThrow } from "../src/domain.js";
import { parseJson } from "../src/json.js";
import { mulDivRoundHalfUp } from "../src/money.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { buildProposal } from "../src/proposal/build.js";
import {
  ADVANCE_DOMAIN_NAME,
  ADVANCE_DOMAIN_VERSION,
  advanceMessageSchema,
  makeQuoteId,
} from "../src/proposal/typed.js";
import {
  canonicalMandate,
  mandateJsonSchema,
  mandateJsonSchemaV1,
  matchesJsonSchema,
  parseMandate,
} from "../src/schema/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../examples");
const V2 = ["epoch.json", "fifo.json", "quarterly.json"];
const SOURCE: Record<string, string> = {
  "epoch.json": "epoch.json",
  "weekly.json": "legacy.json",
  "quarterly.json": "quarterly.json",
  "fifo.json": "fifo.json",
};

function load(folder: string): { name: string; body: unknown }[] {
  const dir = join(root, folder);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, body: parseJson(readFileSync(join(dir, name), "utf8")) }));
}

function taken(rows: { name: string; body: unknown }[], name: string): unknown {
  const found = rows.find((item) => item.name === name);
  expect(found, name).toBeDefined();
  return found!.body;
}

describe("sample mandates and proposals", () => {
  const mandates = load("mandates");
  const proposals = load("proposals");

  it("parses each version 2 mandate and rejects it as version 1", () => {
    expect(mandates.map((item) => item.name)).toEqual([
      "epoch.json",
      "fifo.json",
      "legacy.json",
      "quarterly.json",
    ]);
    for (const name of V2) {
      const body = taken(mandates, name);
      expect(matchesJsonSchema(mandateJsonSchema(), body), name).toBe(true);
      expect(matchesJsonSchema(mandateJsonSchemaV1(), body), name).toBe(false);
    }
    expect(parseMandate(taken(mandates, "epoch.json")).maxTenorSeconds).toBe(3_456_000);
    expect(parseMandate(taken(mandates, "fifo.json")).maxTenorSeconds).toBe(3_456_000);
    expect(parseMandate(taken(mandates, "quarterly.json")).maxTenorSeconds).toBe(7_776_000);
    expect(parseMandate(taken(mandates, "epoch.json")).approvedPlatforms).toEqual([
      "0x00000000000000000000000000000000000000B1",
    ]);
  });

  it("parses the version 1 tenor and copies it onto the current mandate", () => {
    const legacy = taken(mandates, "legacy.json");
    expect(matchesJsonSchema(mandateJsonSchemaV1(), legacy)).toBe(true);
    expect(matchesJsonSchema(mandateJsonSchema(), legacy)).toBe(false);
    const parsed = parseMandate(legacy);
    expect(parsed.maxTenorSeconds).toBe(3_456_000);
    expect(parsed).not.toHaveProperty("maxTenor");
    expect(matchesJsonSchema(mandateJsonSchema(), canonicalMandate(legacy))).toBe(true);
  });

  it("builds a submittable advance for each queue kind", () => {
    expect(proposals.map((item) => item.name)).toEqual([
      "epoch.json",
      "fifo.json",
      "quarterly.json",
      "weekly.json",
    ]);
    const chains = new Set<number>();
    const kinds = new Set<string>();
    for (const sample of proposals) {
      const body = parseOrThrow(proposeBodySchema, sample.body);
      expect(body.mandate).toEqual(parseMandate(taken(mandates, SOURCE[sample.name]!)));
      expect(body.params).toEqual(DEFAULT_PARAMS);
      expect(ALLOWED_CHAIN_IDS.has(body.chainId)).toBe(true);
      chains.add(body.chainId);
      kinds.add(body.input.kind);
      const storedKey = Object.keys(body.mandate.platformLimits)[0];
      expect(storedKey).toMatch(/^0x[0-9a-f]{40}$/);
      const built = buildProposal({
        input: body.input,
        params: body.params,
        mandate: body.mandate,
        platform: body.platform,
        recipient: body.recipient,
        chainId: body.chainId,
        nonce: body.nonce,
        wall: body.input.now,
      });
      expect(built.submittable, sample.name).toBe(true);
      expect(built.message.platform.toLowerCase()).toBe(storedKey);
      expect(parseOrThrow(advanceMessageSchema, built.message)).toEqual(built.message);
      expect(built.message.quoteId).toBe(makeQuoteId({
        platform: built.message.platform,
        navValue: built.quote.navValue,
        fee: built.quote.fee,
        dueAt: built.quote.dueAt,
        riskBps: built.quote.risk.bps,
        utilizationBps: built.input.utilizationBps,
        navUpdatedAt: built.input.navUpdatedAt,
        kind: built.input.kind,
      }));
      expect(built.message.payout + built.message.fee).toBe(built.message.navValue);
      expect(built.message.fee).toBe(mulDivRoundHalfUp(built.message.navValue, BigInt(built.message.feeBps), 10_000n));
      expect(built.quote.secondsToClear).toBeLessThanOrEqual(body.mandate.maxTenorSeconds);
      expect(built.message.feeBps).toBeGreaterThanOrEqual(DEFAULT_PARAMS.minFeeBps);
      expect(built.message.feeBps).toBeLessThanOrEqual(DEFAULT_PARAMS.maxFeeBps);
      expect(built.calldata.startsWith("0xe7c1fee8")).toBe(true);
      expect(built.domain).toMatchObject({ name: ADVANCE_DOMAIN_NAME, version: ADVANCE_DOMAIN_VERSION });
      if (sample.name === "epoch.json") {
        expect(storedKey).toBe("0x00000000000000000000000000000000000000b1");
        expect(built.message.platform).toBe("0x00000000000000000000000000000000000000B1");
        expect(body.input.navValue).toBe(10_000_000_000n);
        expect(built.message.feeBps).toBe(109);
      }
      if (sample.name === "weekly.json") {
        expect(body.input.epochStart).toBe(1_699_827_200);
        expect(built.quote.secondsToClear).toBe(432_000);
        expect(built.message.feeBps).toBe(25);
      }
      if (sample.name === "fifo.json") {
        expect(built.quote.secondsToClear).toBe(86_400);
        expect(built.message.feeBps).toBe(25);
      }
      if (sample.name === "quarterly.json") {
        expect(built.quote.secondsToClear).toBe(7_776_000);
        expect(built.message.feeBps).toBe(328);
      }
    }
    expect([...chains].sort((a, b) => a - b)).toEqual([31_337, 421_614, 11_155_111]);
    expect([...kinds].sort()).toEqual(["epoch", "fifo-open", "quarterly-gated", "weekly-cycle"]);
  });

  it("rejects a fee above uint16, a short quote id, a wide timestamp, and a broken payout", () => {
    const body = parseOrThrow(proposeBodySchema, taken(proposals, "epoch.json"));
    const built = buildProposal({
      input: body.input,
      params: body.params,
      mandate: body.mandate,
      platform: body.platform,
      recipient: body.recipient,
      chainId: body.chainId,
      nonce: body.nonce,
      wall: body.input.now,
    });
    const fee = advanceMessageSchema.safeParse({ ...built.message, feeBps: 70_000 });
    const quoteId = advanceMessageSchema.safeParse({ ...built.message, quoteId: "0x11" });
    const dueAt = advanceMessageSchema.safeParse({ ...built.message, dueAt: 1n << 64n });
    const payout = advanceMessageSchema.safeParse({ ...built.message, payout: built.message.payout + 1n });
    expect(fee.success).toBe(false);
    expect(quoteId.success).toBe(false);
    expect(dueAt.success).toBe(false);
    expect(payout.success).toBe(false);
    if (!fee.success) expect(fee.error.issues[0]?.path).toEqual(["feeBps"]);
    if (!quoteId.success) expect(quoteId.error.issues[0]?.path).toEqual(["quoteId"]);
    if (!dueAt.success) expect(dueAt.error.issues[0]?.path).toEqual(["dueAt"]);
    if (!payout.success) expect(payout.error.issues.map((issue) => issue.message)).toContain("payout plus fee must equal nav");
  });
});
