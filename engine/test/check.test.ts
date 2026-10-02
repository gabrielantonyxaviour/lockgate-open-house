import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfig, type CheckArea, type CheckReport } from "../src/check/config.js";
import { respond, run } from "../src/cli.js";
import { runCreTick } from "../src/cre/tick.js";
import { isApiError } from "../src/errors.js";
import { encodeJson } from "../src/json.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";

const PLATFORM = "0x00000000000000000000000000000000000000b1";
const PAYOUT = "0x00000000000000000000000000000000000000b2";
const NOW = 1_700_000_000;

function codes(report: CheckReport, area: CheckArea): string[] {
  return report.findings.filter((item) => item.area === area && !item.ok).map((item) => item.code);
}

function validConfig(): Record<string, unknown> {
  return {
    chainId: 31337,
    now: NOW,
    policy: "lowest-fee",
    roundRobin: 0,
    params: DEFAULT_PARAMS,
    vaults: [{
      idle: "50000000000",
      cursor: 0,
      mandate: {
        vault: "0x00000000000000000000000000000000000000c1",
        partner: "0x00000000000000000000000000000000000000d1",
        signer: "0x00000000000000000000000000000000000000d1",
        approvedPlatforms: [PLATFORM],
        platformLimits: { [PLATFORM]: "100000000000" },
        minFeeBps: 20,
        maxTenorSeconds: 40 * 86_400,
        concentrationCapBps: 5000,
        expiresAt: NOW + 40 * 86_400,
        payoutTo: PAYOUT,
        idle: "50000000000",
        totalAssets: "100000000000",
      },
    }],
    requests: [{
      platform: PLATFORM,
      recipient: PAYOUT,
      nonce: "4",
      input: {
        platformId: "harbor-weekly",
        kind: "weekly-cycle",
        now: NOW,
        navValue: "1000000",
        queuedAhead: "0",
        cashAvailable: "50000000000",
        cashPerEpoch: "50000000000",
        cashKnown: true,
        gated: false,
        navUpdatedAt: NOW - 3600,
        reserveBalance: "1000000",
        reserveBps: 750,
        exposure: "0",
        limit: "25000000000",
        bookAssets: "100000000000",
        utilizationBps: 0,
        repayment: { samples: 8, onTime: 8, late: 0, slashed: 0, gateEvents: 0, windowsObserved: 8 },
        epochStart: NOW,
        epochSeconds: 604_800,
        clearingSeconds: 86_400,
        requestId: "11",
      },
      kasu: {
        kind: "weekly-cycle",
        epochStart: NOW,
        epochSeconds: 604_800,
        clearingSeconds: 86_400,
        clearingNow: false,
        epochNumber: 1,
        queuedShares: "0",
        queuedValue: "0",
        poolDecimals: 6,
        truncated: false,
        notes: [],
      },
    }],
  };
}

function shiftClock(body: Record<string, unknown>, now: number): Record<string, unknown> {
  const delta = now - NOW;
  body.now = now;
  const vault = (body.vaults as { mandate: { expiresAt: number } }[])[0];
  const request = (body.requests as { input: Record<string, number>; kasu: { epochStart: number } }[])[0];
  if (!vault || !request) throw new Error("fixture lost a section");
  vault.mandate.expiresAt += delta;
  request.input.now += delta;
  request.input.navUpdatedAt += delta;
  request.input.epochStart += delta;
  request.kasu.epochStart += delta;
  return body;
}

describe("config check", () => {
  it("accepts a mandate, a matching adapter, and limits that can fund the advance", () => {
    const report = checkConfig(validConfig());
    expect(report.ok).toBe(true);
    expect(report.findings.every((item) => item.ok && item.message.length > 0)).toBe(true);
    expect(new Set(report.findings.map((item) => item.area))).toEqual(new Set(["mandate", "adapter", "limit"]));
    expect(report.findings.find((item) => item.area === "adapter")?.code).toBe("adapter");
    const fixture = checkConfig(JSON.parse(readFileSync("fixtures/sepolia/cre.json", "utf8")));
    expect(fixture.ok).toBe(true);
    expect(fixture.findings.find((item) => item.area === "adapter")?.code).toBe("none");
    expect(report.findings.some((item) => item.code === "signable")).toBe(true);
    expect(fixture.findings.some((item) => item.code === "signable")).toBe(true);
    const tick = runCreTick(validConfig());
    expect(tick.proposals).toHaveLength(1);
    expect(tick.proposals[0]?.submittable).toBe(true);
    expect(tick.skipped).toEqual([]);
  });

  it("refuses a book the quote or the mandate would not sign", () => {
    const gated = validConfig();
    const gatedRequest = (gated.requests as { input: Record<string, unknown> }[])[0];
    if (!gatedRequest) throw new Error("fixture lost a request");
    gatedRequest.input.gated = true;
    const gatedReport = checkConfig(gated);
    expect(gatedReport.ok).toBe(false);
    expect(codes(gatedReport, "mandate")).toContain("gated");
    expect(runCreTick(gated).skipped.map((item) => item.code)).toEqual(["gated"]);

    const stale = validConfig();
    const staleRequest = (stale.requests as { input: Record<string, unknown> }[])[0];
    if (!staleRequest) throw new Error("fixture lost a request");
    staleRequest.input.navUpdatedAt = NOW - DEFAULT_PARAMS.maxNavAgeSeconds - 1;
    const staleReport = checkConfig(stale);
    expect(staleReport.ok).toBe(false);
    expect(codes(staleReport, "mandate")).toContain("stale-nav");
    expect(runCreTick(stale).skipped.map((item) => item.code)).toEqual(["stale-nav"]);

    const cash = validConfig();
    const vault = (cash.vaults as { mandate: Record<string, unknown> }[])[0];
    if (!vault) throw new Error("fixture lost a vault");
    vault.mandate.idle = "1";
    const cashReport = checkConfig(cash);
    expect(cashReport.ok).toBe(false);
    expect(codes(cashReport, "mandate")).toContain("cash");
    expect(cashReport.findings.some((item) => item.code === "signable")).toBe(false);
    expect(runCreTick(cash).skipped.map((item) => item.code)).toEqual(["cash"]);

    const unnamed = validConfig();
    const unnamedRequest = (unnamed.requests as { input: Record<string, unknown> }[])[0];
    if (!unnamedRequest) throw new Error("fixture lost a request");
    delete unnamedRequest.input.requestId;
    const unnamedReport = checkConfig(unnamed);
    expect(unnamedReport.ok).toBe(false);
    expect(codes(unnamedReport, "mandate")).toContain("request");
    expect(unnamedReport.findings.some((item) => item.code === "signable")).toBe(false);
    expect(runCreTick(unnamed).skipped.map((item) => item.code)).toEqual(["request"]);
  });

  it("follows the routed vault, including a fee the signer would raise", () => {
    const floored = validConfig();
    const floorVault = (floored.vaults as { mandate: Record<string, unknown> }[])[0];
    if (!floorVault) throw new Error("fixture lost a vault");
    floorVault.mandate.minFeeBps = 400;
    const floorReport = checkConfig(floored);
    expect(floorReport.ok).toBe(true);
    expect(floorReport.findings.some((item) => item.code === "signable")).toBe(true);
    const floorTick = runCreTick(floored);
    expect(floorTick.proposals).toHaveLength(1);
    expect(floorTick.proposals[0]?.quote.feeBps).toBe(400);
    expect(floorTick.skipped).toEqual([]);

    const routed = validConfig();
    const open = (routed.vaults as Record<string, unknown>[])[0];
    if (!open) throw new Error("fixture lost a vault");
    routed.vaults = [
      open,
      {
        ...open,
        cursor: 1,
        mandate: {
          ...(open.mandate as Record<string, unknown>),
          vault: "0x00000000000000000000000000000000000000c2",
          minFeeBps: 10,
          paused: true,
        },
      },
    ];
    const routedReport = checkConfig(routed);
    expect(routedReport.ok).toBe(false);
    expect(codes(routedReport, "mandate")).toContain("paused");
    expect(routedReport.findings.some((item) => item.code === "signable")).toBe(false);
    expect(runCreTick(routed).skipped.map((item) => item.code)).toEqual(["paused"]);
    expect(runCreTick(routed).proposals).toEqual([]);

    const short = validConfig();
    const shortVault = (short.vaults as { idle: string }[])[0];
    if (!shortVault) throw new Error("fixture lost a vault");
    shortVault.idle = "1";
    const shortReport = checkConfig(short);
    expect(shortReport.ok).toBe(false);
    expect(codes(shortReport, "mandate")).toContain("no-vault");
    expect(shortReport.findings.some((item) => item.code === "signable")).toBe(false);
    expect(runCreTick(short).skipped.map((item) => item.code)).toEqual(["no-vault"]);
  });

  it("uses this machine's clock the way the tick does", () => {
    const machine = Math.floor(Date.now() / 1000);
    const near = shiftClock(validConfig(), machine + 3_600);
    expect(checkConfig(near).findings.some((item) => item.code === "signable")).toBe(true);
    expect(runCreTick(near).proposals).toHaveLength(1);
    const far = shiftClock(validConfig(), machine + 90_000);
    const farReport = checkConfig(far);
    expect(farReport.ok).toBe(false);
    expect(codes(farReport, "mandate")).toContain("clock");
    expect(farReport.findings.some((item) => item.code === "signable")).toBe(false);
    expect(runCreTick(far).skipped.map((item) => item.code)).toEqual(["clock"]);
  });

  it("reports mandate, adapter, and limit failures in one document", () => {
    const body = validConfig();
    const vault = (body.vaults as { mandate: Record<string, unknown> }[])[0]?.mandate;
    const request = (body.requests as Record<string, unknown>[])[0];
    const input = request?.input as Record<string, unknown>;
    const kasu = request?.kasu as Record<string, unknown>;
    if (!vault || !request || !input || !kasu) throw new Error("fixture lost a section");
    body.chainId = 1;
    vault.paused = true;
    vault.expiresAt = NOW;
    vault.platformLimits = {};
    vault.minFeeBps = 9_000;
    input.kind = "epoch";
    input.limit = "1";
    input.reserveBps = 100;
    kasu.poolDecimals = null;
    kasu.truncated = true;
    const report = checkConfig(body);
    expect(report.ok).toBe(false);
    expect(isApiError(report)).toBe(false);
    expect(codes(report, "mandate")).toEqual(expect.arrayContaining(["chain", "paused", "expired", "platform-limit"]));
    expect(codes(report, "adapter")).toEqual(expect.arrayContaining(["adapter-kind", "pool-decimals", "scan-truncated"]));
    expect(codes(report, "limit")).toEqual(expect.arrayContaining(["mandate-min", "limit", "reserve-policy"]));
  });

  it("reports two adapter reads and a bad version without throwing", () => {
    const body = validConfig();
    const request = (body.requests as Record<string, unknown>[])[0];
    if (!request) throw new Error("fixture lost a request");
    request.maple = {
      kind: "fifo-open",
      nextRequestId: "1",
      lastRequestId: "1",
      queuedShares: "0",
      queuedValue: null,
      totalAssets: null,
      assetDecimals: 6,
      truncated: false,
      cashKnown: false,
      notes: [],
    };
    const doubled = checkConfig(body);
    expect(doubled.ok).toBe(false);
    expect(doubled.findings.some((item) => item.area === "adapter" && item.message.includes("one adapter"))).toBe(true);
    const version = checkConfig({ schemaVersion: 9 });
    expect(version.ok).toBe(false);
    expect(version.findings).toEqual([{
      area: "mandate",
      path: "schemaVersion",
      ok: false,
      code: "schema-version",
      message: "unsupported config schema version",
    }]);
  });

  it("prints the report from the check command and rejects a non-object", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-check-"));
    const file = join(dir, "config.json");
    writeFileSync(file, encodeJson(validConfig()));
    const printed = await run(["check", "--file", file]) as CheckReport;
    expect(printed).toEqual(checkConfig(validConfig()));
    expect(printed.ok).toBe(true);
    writeFileSync(file, "[]");
    expect(await respond(["check", "--file", file])).toEqual({ error: "config must be an object", code: "param" });
    expect(await respond(["check"])).toEqual({ error: "pass --file", code: "usage" });
  });
});
