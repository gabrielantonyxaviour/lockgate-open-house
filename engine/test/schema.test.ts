import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch } from "../src/examples.js";
import { runCreTick } from "../src/cre/tick.js";
import { EngineError } from "../src/errors.js";
import {
  canonicalConfig,
  canonicalMandate,
  configJsonSchema,
  mandateJsonSchema,
  mandateJsonSchemaV1,
  matchesJsonSchema,
  migrateMandate,
  migrateProposeBody,
  parseConfig,
  parseMandate,
} from "../src/schema/index.js";

const now = 1_700_000_000;
const platform = "0x00000000000000000000000000000000000000b1";
const recipient = "0x00000000000000000000000000000000000000b2";
const vault = "0x00000000000000000000000000000000000000c1";
const signer = "0x00000000000000000000000000000000000000d1";

function mandate(tenor: Record<string, unknown>): Record<string, unknown> {
  return {
    vault,
    partner: signer,
    signer,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: "100000000000" },
    minFeeBps: 20,
    concentrationCapBps: 5000,
    expiresAt: now + 86_400,
    payoutTo: recipient,
    idle: "50000000000",
    totalAssets: "100000000000",
    ...tenor,
  };
}

function requiredOf(schema: Record<string, unknown>): string[] {
  return schema.required as string[];
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)));
}

describe("mandate and config schema versions", () => {
  it("migrates maxTenor to maxTenorSeconds once", () => {
    const v1 = { ...mandate({ schemaVersion: 1, maxTenor: 3_456_000 }) };
    const once = migrateMandate(v1);
    const twice = migrateMandate(once);
    expect(once).toEqual(twice);
    expect(once).toMatchObject({ maxTenorSeconds: 3_456_000 });
    expect(once).not.toHaveProperty("maxTenor");
    expect(once).not.toHaveProperty("schemaVersion");
    expect(parseMandate(v1).maxTenorSeconds).toBe(3_456_000);
  });

  it("keeps a current mandate that already uses maxTenorSeconds", () => {
    const parsed = parseMandate(mandate({ maxTenorSeconds: 86_400 }));
    expect(parsed.maxTenorSeconds).toBe(86_400);
    const same = parseMandate(mandate({ schemaVersion: 2, maxTenor: 86_400, maxTenorSeconds: 86_400 }));
    expect(same.maxTenorSeconds).toBe(86_400);
  });

  it("rejects a tenor clash and an unknown version", () => {
    expect(() => parseMandate(mandate({ maxTenor: 1, maxTenorSeconds: 2 }))).toThrow(EngineError);
    expect(() => parseMandate(mandate({ schemaVersion: 3, maxTenorSeconds: 86_400 }))).toThrow(EngineError);
    expect(() => parseConfig({ schemaVersion: 4 })).toThrow(EngineError);
    try {
      parseMandate(mandate({ schemaVersion: 9, maxTenorSeconds: 86_400 }));
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe("param");
      expect((err as EngineError).message).toContain("mandate");
    }
  });

  it("publishes JSON Schema for mandate v1 and v2", () => {
    const v1 = mandateJsonSchemaV1();
    const v2 = mandateJsonSchema();
    expect(v1.$id).toBe("lockgate://schema/mandate/1");
    expect(v2.$id).toBe("lockgate://schema/mandate/2");
    expect(requiredOf(v1)).toContain("maxTenor");
    expect(requiredOf(v1)).not.toContain("maxTenorSeconds");
    expect(requiredOf(v2)).toContain("maxTenorSeconds");
    expect(requiredOf(v2)).not.toContain("maxTenor");
    expect(v1.additionalProperties).toBe(false);
    expect(v2.additionalProperties).toBe(false);
    const version = (v2.properties as Record<string, { const?: number }>).schemaVersion;
    expect(version?.const).toBe(2);
  });

  it("migrates a v1 config and prices the tick", () => {
    const raw = {
      schemaVersion: 1,
      chainId: 31337,
      now,
      params: DEFAULT_PARAMS,
      vaults: [{
        idle: "50000000000",
        cursor: 0,
        mandate: mandate({ maxTenor: 40 * 86_400 }),
      }],
      requests: [{
        input: monthEpoch(now),
        platform,
        recipient,
        nonce: "7",
      }],
    };
    expect(parseConfig(raw).vaults[0]?.mandate.maxTenorSeconds).toBe(40 * 86_400);
    const tick = runCreTick(raw);
    expect(tick.proposals).toHaveLength(1);
    expect(tick.proposals[0]?.mandate.maxTenorSeconds).toBe(40 * 86_400);
    const moved = migrateProposeBody({ mandate: mandate({ schemaVersion: 1, maxTenor: 86_400 }) }) as {
      mandate: Record<string, unknown>;
    };
    expect(moved.mandate.maxTenorSeconds).toBe(86_400);
    expect(moved.mandate).not.toHaveProperty("maxTenor");
  });

  it("accepts a migrated document and rejects the version 1 tenor", () => {
    const v1 = mandate({ schemaVersion: 1, maxTenor: 3_456_000 });
    const published = mandateJsonSchema();
    const configSchema = configJsonSchema();
    expect(JSON.stringify(published)).not.toContain("{}");
    expect(JSON.stringify(configSchema)).not.toContain("{}");
    expect(matchesJsonSchema(published, v1)).toBe(false);
    expect(matchesJsonSchema(published, asJson(canonicalMandate(v1)))).toBe(true);
    const dirty = canonicalMandate(v1);
    dirty.note = "extra";
    expect(matchesJsonSchema(published, dirty)).toBe(false);
    const badAmount = canonicalMandate(v1);
    badAmount.platformLimits = { [platform]: { raw: true } };
    expect(matchesJsonSchema(published, badAmount)).toBe(false);
    const raw = {
      schemaVersion: 1,
      chainId: 31337,
      now,
      params: DEFAULT_PARAMS,
      vaults: [{ idle: "50000000000", cursor: 0, mandate: mandate({ maxTenor: 40 * 86_400 }) }],
      requests: [{ input: monthEpoch(now), platform, recipient, nonce: "7" }],
    };
    expect(matchesJsonSchema(configSchema, asJson(raw))).toBe(false);
    expect(matchesJsonSchema(configSchema, asJson(canonicalConfig(raw)))).toBe(true);
  });

  it("publishes the config JSON Schema at version 2", () => {
    const schema = configJsonSchema();
    const text = JSON.stringify(schema);
    expect(schema.$id).toBe("lockgate://schema/config/2");
    expect(schema.additionalProperties).toBe(false);
    expect((schema.properties as Record<string, { const?: number }>).schemaVersion?.const).toBe(2);
    expect(text).toContain('"maxTenorSeconds"');
    expect(text).not.toContain('"maxTenor"');
  });
});
