import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { asBigint, MAX_QUEUE_SCAN, scanBound } from "../src/adapters/reader.js";
import { readMaple } from "../src/adapters/maple/read.js";
import { DEPLOYMENTS } from "../src/adapters/deployments.js";
import type { ContractReader } from "../src/adapters/reader.js";
import { ALLOWED_CHAIN_IDS, assertTransactableChain } from "../src/chains.js";
import { zAmount } from "../src/domain.js";
import { EngineError } from "../src/errors.js";
import { monthEpoch } from "../src/examples.js";
import { parseJson } from "../src/json.js";
import { toUsdg6 } from "../src/money.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import { buildProposal } from "../src/proposal/build.js";
import { filePartnerProposal } from "../src/proposal/partner.js";
import { signBuiltProposal } from "../src/proposal/sign.js";
import { quoteExit } from "../src/quote.js";
import { broadcastOwnBook, planSweep, type SweepAction } from "../src/sweep/sweep.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const U = 1_000_000n;
const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const stranger = getAddress("0x00000000000000000000000000000000000000b3");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const line = getAddress("0x00000000000000000000000000000000000000e1");

function mandate(patch: Record<string, unknown> = {}) {
  return {
    vault,
    partner: vault,
    signer: vault,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: 100_000n * U },
    minFeeBps: 10,
    maxTenorSeconds: 40 * 86_400,
    concentrationCapBps: 5_000,
    expiresAt: now + 86_400,
    payoutTo: recipient,
    idle: 50_000n * U,
    totalAssets: 100_000n * U,
    ...patch,
  };
}

function propose(patch: {
  input?: unknown;
  mandate?: unknown;
  recipient?: string;
  chainId?: number;
  params?: unknown;
} = {}) {
  return buildProposal({
    input: patch.input ?? monthEpoch(now),
    params: patch.params ?? DEFAULT_PARAMS,
    mandate: patch.mandate ?? mandate(),
    platform,
    recipient: patch.recipient ?? recipient,
    chainId: patch.chainId ?? 31337,
    nonce: 4n,
  });
}

function repay(): SweepAction {
  return planSweep({
    chainId: 31337,
    now: 1_000_000,
    graceSeconds: 86_400,
    advances: [{
      id: 1n,
      vault: line,
      platform,
      navValue: 1_000n,
      dueAt: 999_000,
      status: "active",
      cash: 5_000n,
      vaultKind: "own-book",
    }],
  })[0]!;
}

describe("security regressions", () => {
  it("signs only the three allowlisted chains", () => {
    expect([...ALLOWED_CHAIN_IDS].sort((left, right) => left - right)).toEqual([31337, 421614, 11155111]);
    for (const chainId of [31337, 421614, 11155111]) {
      assertTransactableChain(chainId);
      expect(propose({ chainId }).submittable).toBe(true);
    }
    expect(() => assertTransactableChain(42170)).toThrow(EngineError);
    expect(() => propose({ chainId: 42170 })).toThrow(EngineError);
  });

  it("refuses a recipient, a missing vault snapshot, a thin vault, and a full-nav fee", () => {
    const wrong = propose({
      recipient: stranger,
      mandate: mandate({ payoutTo: undefined }),
    });
    expect(wrong.submittable).toBe(false);
    expect(wrong.blocks.map((item) => item.code)).toContain("recipient");
    const blind = propose({ mandate: mandate({ idle: undefined, totalAssets: undefined }) });
    expect(blind.blocks.map((item) => item.code)).toContain("vault-snapshot");
    const poor = propose({ mandate: mandate({ idle: 1n }) });
    expect(poor.blocks.map((item) => item.code)).toContain("cash");
    const tight = propose({ mandate: mandate({ totalAssets: 1_000_000n }) });
    expect(tight.blocks.map((item) => item.code)).toContain("vault-concentration");
    const paused = propose({ mandate: mandate({ paused: true }) });
    expect(paused.blocks.map((item) => item.code)).toContain("paused");
    const eaten = propose({
      params: { ...DEFAULT_PARAMS, maxFeeBps: 10_000 },
      mandate: mandate({ minFeeBps: 10_000 }),
    });
    expect(eaten.submittable).toBe(false);
    expect(eaten.blocks.map((item) => item.code)).toContain("zero-payout");
  });

  it("will not sign a truncated scan or a clock more than a day ahead", () => {
    const input = { ...monthEpoch(now), truncated: true, allowPartialScan: true };
    expect(quoteExit(input, DEFAULT_PARAMS).available).toBe(true);
    const partial = propose({ input });
    expect(partial.submittable).toBe(false);
    expect(partial.blocks.map((item) => item.code)).toContain("scan-truncated");
    const ahead = Math.floor(Date.now() / 1000) + 90_000;
    const future = propose({
      input: monthEpoch(ahead),
      mandate: mandate({ expiresAt: ahead + 86_400 }),
    });
    expect(future.blocks.map((item) => item.code)).toContain("clock");
    const close = Math.floor(Date.now() / 1000) + 3_600;
    expect(propose({
      input: monthEpoch(close),
      mandate: mandate({ expiresAt: close + 86_400 }),
    }).submittable).toBe(true);
  });

  it("rejects unsafe numbers and rounds queue dust up, cash dust down", () => {
    expect(() => parseJson('{"nav":9007199254740993}')).toThrow(EngineError);
    expect(() => zAmount.parse(2 ** 53)).toThrow();
    expect(zAmount.parse("9007199254740993")).toBe(9007199254740993n);
    const dust = 10n ** 12n + 1n;
    expect(toUsdg6(dust, 18, "floor")).toBe(1n);
    expect(toUsdg6(dust, 18, "ceil")).toBe(2n);
    expect(() => asBigint(2 ** 53, "assets")).toThrow();
    expect(() => asBigint(-1n, "assets")).toThrow();
  });

  it("caps a queue scan and does not walk a million ids", async () => {
    expect(scanBound(1_000_000)).toBe(MAX_QUEUE_SCAN);
    let requests = 0;
    const reader: ContractReader = {
      async readContract({ functionName }) {
        if (functionName === "requests") requests += 1;
        if (functionName === "queue") return [1n, 300n];
        if (functionName === "decimals") return 6;
        if (functionName === "totalAssets") return 1n;
        throw new Error(functionName);
      },
    };
    const wide = await readMaple(reader, { ...DEPLOYMENTS.mapleSepoliaSyrupUsdc, maxScan: 1_000_000 });
    expect(wide.truncated).toBe(true);
    expect(requests).toBe(0);
  });

  it("sends only repay or markLate to the named credit line", async () => {
    const action = repay();
    let calls = 0;
    const sender = async (): Promise<Hex> => {
      calls += 1;
      return "0x11";
    };
    await expect(broadcastOwnBook([action], 31337, vault, sender)).rejects.toThrow(EngineError);
    await expect(broadcastOwnBook([{ ...action, calldata: "0xdeadbeef" }], 31337, line, sender)).rejects.toThrow(EngineError);
    await expect(broadcastOwnBook([action, action], 31337, line, sender)).rejects.toThrow(EngineError);
    expect(calls).toBe(0);
    let inner = 0;
    await expect(broadcastOwnBook([action], 31337, line, async () => {
      await broadcastOwnBook([action], 31337, line, async () => {
        inner += 1;
        return "0x22";
      });
      return "0x11";
    })).rejects.toThrow(EngineError);
    expect(inner).toBe(0);
  });

  it("does not file a signature that was made for a different nonce", async () => {
    const built = propose();
    expect(built.message.fee).toBeGreaterThanOrEqual((built.message.navValue * 10n) / 10_000n);
    const signature = await signBuiltProposal(built, ANVIL);
    const proposer = privateKeyToAccount(ANVIL).address;
    const forged = { ...built.partner, message: { ...built.partner.message, nonce: 99n } };
    let calls = 0;
    await expect(filePartnerProposal(forged, true, signature, 31337, proposer, async () => {
      calls += 1;
      return "0x11";
    })).rejects.toThrow(EngineError);
    expect(calls).toBe(0);
  });
});
