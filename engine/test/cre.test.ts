import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { monthEpoch } from "../src/examples.js";
import { runCreTick } from "../src/cre/tick.js";
import { EngineError } from "../src/errors.js";

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
    expect(tick.proposals[0]?.calldata.startsWith("0x")).toBe(true);
    const gated = runCreTick(config(31337, true));
    expect(gated.proposals).toHaveLength(0);
    expect(gated.skipped[0]?.code).toBe("gated");
  });

  it("refuses to prepare a mainnet submission", () => {
    expect(() => runCreTick(config(1))).toThrow(EngineError);
    expect(() => runCreTick(config(42161))).toThrow(EngineError);
  });
});
