import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { mapleCovered, monthEpoch, weeklyClear } from "../src/examples.js";
import { creEntry, runCreTick } from "../src/cre/tick.js";
import { EngineError } from "../src/errors.js";
import type { KasuRead } from "../src/adapters/kasu/read.js";
import type { MapleRead } from "../src/adapters/maple/read.js";
import type { UsdaiRead } from "../src/adapters/usdai/read.js";

const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

function config(chainId = 31337, gated = false) {
  return {
    chainId,
    now,
    params: DEFAULT_PARAMS,
    policy: "lowest-fee",
    vaults: [{
      idle: "50000000000",
      cursor: 1,
      mandate: {
        vault,
        partner: signer,
        signer,
        approvedPlatforms: [platform],
        platformLimits: { [platform]: "100000000000" },
        minFeeBps: 20,
        maxTenorSeconds: 40 * 86_400,
        concentrationCapBps: 5000,
        expiresAt: now + 86_400,
        payoutTo: recipient,
        idle: "50000000000",
        totalAssets: "100000000000",
      },
    }],
    requests: [{
      input: { ...monthEpoch(now), gated },
      platform,
      recipient,
      nonce: "7",
    }],
  };
}

describe("CRE tick", () => {
  it("builds one local proposal and skips a gated exit", () => {
    const tick = runCreTick(config());
    expect(tick.proposals).toHaveLength(1);
    expect(tick.proposals[0]?.submittable).toBe(true);
    expect(tick.proposals[0]?.message.nonce).toBe(7n);
    expect(tick.proposals[0]?.calldata.startsWith("0xe7c1fee8")).toBe(true);
    const gated = runCreTick(config(31337, true));
    expect(gated.proposals).toHaveLength(0);
    expect(gated.skipped[0]?.code).toBe("gated");
  });

  it("refuses to prepare a mainnet submission", () => {
    expect(() => runCreTick(config(1))).toThrow(EngineError);
    expect(() => runCreTick(config(42161))).toThrow(EngineError);
  });

  it("skips an unpriced Kasu read instead of quoting the caller's cash", () => {
    const open = runCreTick({
      ...config(),
      requests: [{ ...config().requests[0], input: weeklyClear(now) }],
    });
    expect(open.proposals).toHaveLength(1);
    const read: KasuRead = {
      kind: "weekly-cycle",
      epochStart: 1_600_000_000,
      epochSeconds: 604_800,
      clearingSeconds: 172_800,
      clearingNow: false,
      epochNumber: 121,
      queuedShares: 3_500_000n,
      queuedValue: null,
      poolDecimals: null,
      truncated: false,
      notes: ["unpriced-tranche:0x00000000000000000000000000000000000000bb"],
    };
    const closed = runCreTick({
      ...config(),
      requests: [{ ...config().requests[0], input: weeklyClear(now), kasu: read }],
    });
    expect(closed.proposals).toHaveLength(0);
    expect(closed.skipped[0]?.code).toBe("illiquid");
  });

  it("prices a Maple read as a 30-day wait", () => {
    const read: MapleRead = {
      kind: "fifo-open",
      nextRequestId: 10n,
      lastRequestId: 11n,
      queuedShares: 3_000_000n,
      queuedValue: 3_000_000n,
      totalAssets: null,
      assetDecimals: 6,
      truncated: false,
      cashKnown: false,
      notes: ["total-assets-unread"],
    };
    const tick = runCreTick({
      ...config(),
      requests: [{ ...config().requests[0], input: mapleCovered(now), maple: read }],
    });
    expect(tick.proposals).toHaveLength(1);
    expect(tick.proposals[0]?.quote.assumption).toBe("maple-worst-case-30d");
    expect(tick.proposals[0]?.quote.secondsToClear).toBe(2_592_000);
    expect(tick.proposals[0]?.message.dueAt).toBe(BigInt(now + 2_592_000));
  });

  it("skips a zero sUSDai balance and rejects two reads or a partial read", () => {
    const read: UsdaiRead = {
      kind: "epoch",
      nextWindowAt: now + 1,
      epochSeconds: 2_592_000,
      pendingShares: 2_000_000_000_000_000_000n,
      queuedValue: 2_000_000n,
      cashAvailable: 0n,
      nav: 10_000_000_000n,
      sharePrice: 1_000_000_000_000_000_000n,
      assetDecimals: 18,
      timestampWasPast: false,
      notes: ["redemption balance is zero"],
    };
    const tick = runCreTick({
      ...config(),
      requests: [{ ...config().requests[0], usdai: read }],
    });
    expect(tick.proposals).toHaveLength(0);
    expect(tick.skipped[0]?.code).toBe("illiquid");
    const kasu: KasuRead = {
      kind: "weekly-cycle",
      epochStart: 1_600_000_000,
      epochSeconds: 604_800,
      clearingSeconds: 172_800,
      clearingNow: false,
      epochNumber: 121,
      queuedShares: 1n,
      queuedValue: null,
      poolDecimals: null,
      truncated: false,
      notes: ["unpriced"],
    };
    const maple: MapleRead = {
      kind: "fifo-open",
      nextRequestId: 10n,
      lastRequestId: 11n,
      queuedShares: 1n,
      queuedValue: 1n,
      totalAssets: null,
      assetDecimals: 6,
      truncated: false,
      cashKnown: false,
      notes: ["unread"],
    };
    const both = creEntry({
      ...config(),
      requests: [{ ...config().requests[0], kasu, maple }],
    });
    expect(both).toEqual({ error: expect.stringContaining("one adapter read"), code: "param" });
    const partial = creEntry({
      ...config(),
      requests: [{ ...config().requests[0], kasu: { kind: "weekly-cycle", queuedValue: null } }],
    });
    expect(partial).toMatchObject({ code: "param" });
    expect(partial).not.toHaveProperty("stack");
  });

  it("does not fund a Kasu payload whose pool decimals are not 6", () => {
    const read: KasuRead = {
      kind: "weekly-cycle",
      epochStart: 1_600_000_000,
      epochSeconds: 604_800,
      clearingSeconds: 172_800,
      clearingNow: false,
      epochNumber: 121,
      queuedShares: 10n ** 18n,
      queuedValue: 10n ** 18n,
      poolDecimals: null,
      truncated: false,
      notes: ["pool-decimals:0x00000000000000000000000000000000000000aa:18"],
    };
    const tick = runCreTick({
      ...config(),
      requests: [{ ...config().requests[0], input: weeklyClear(now), kasu: read }],
    });
    expect(tick.proposals).toHaveLength(0);
    expect(tick.skipped[0]?.code).toBe("illiquid");
    const open = quoteReady();
    const proposal = open.proposals[0];
    expect(open.proposals).toHaveLength(1);
    expect(proposal?.submittable).toBe(true);
    expect(proposal?.quote.payout! + proposal?.quote.fee!).toBe(proposal?.quote.navValue);
  });
});

function quoteReady() {
  const read: KasuRead = {
    kind: "weekly-cycle",
    epochStart: 1_600_000_000,
    epochSeconds: 604_800,
    clearingSeconds: 172_800,
    clearingNow: false,
    epochNumber: 121,
    queuedShares: 0n,
    queuedValue: 0n,
    poolDecimals: 6,
    truncated: false,
    notes: ["priced at 6 decimals"],
  };
  return runCreTick({
    ...config(),
    requests: [{ ...config().requests[0], input: weeklyClear(now), kasu: read }],
  });
}
