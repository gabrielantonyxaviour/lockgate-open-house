import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { run } from "../src/cli.js";
import { DEFAULT_PARAMS } from "../src/pricing/defaults.js";
import type { Mandate } from "../src/domain.js";
import { EngineError } from "../src/errors.js";
import { monthEpoch, weeklyClear } from "../src/examples.js";
import { parseJson } from "../src/json.js";
import { assessFacility } from "../src/facility/assess.js";
import { buildProposal } from "../src/proposal/build.js";
import { quoteExit } from "../src/quote.js";
import { runCreTick } from "../src/cre/tick.js";
import { planSweep } from "../src/sweep/sweep.js";

const U = 1_000_000n;
const now = 1_700_000_000;
const platform = getAddress("0x00000000000000000000000000000000000000b1");
const recipient = getAddress("0x00000000000000000000000000000000000000b2");
const vault = getAddress("0x00000000000000000000000000000000000000c1");
const signer = getAddress("0x00000000000000000000000000000000000000d1");

function mandate(): Mandate {
  return {
    vault,
    partner: signer,
    signer,
    approvedPlatforms: [platform],
    platformLimits: { [platform]: 100_000n * U },
    minFeeBps: 10,
    maxTenorSeconds: 40 * 86_400,
    concentrationCapBps: 5_000,
    expiresAt: now + 86_400,
    payoutTo: recipient,
    idle: 50_000n * U,
    totalAssets: 100_000n * U,
  };
}

function expectParam(runCase: () => unknown): void {
  try {
    runCase();
    expect.fail("malformed input was accepted");
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("param");
  }
}

describe("adversarial inputs", () => {
  it("rejects malformed values at every zod boundary", () => {
    expectParam(() => quoteExit({ ...monthEpoch(now), kind: "maple" }, DEFAULT_PARAMS));
    expectParam(() => quoteExit({ ...monthEpoch(now), navValue: -1n }, DEFAULT_PARAMS));
    expectParam(() => quoteExit({ ...monthEpoch(now), utilizationBps: 10_001 }, DEFAULT_PARAMS));
    expectParam(() => quoteExit({
      ...monthEpoch(now),
      repayment: { samples: 3, onTime: 1, late: 0, slashed: 0, gateEvents: 0, windowsObserved: 0 },
    }, DEFAULT_PARAMS));
    expectParam(() => quoteExit(monthEpoch(now), { ...DEFAULT_PARAMS, minFeeBps: 100, maxFeeBps: 1 }));
    expectParam(() => quoteExit({ ...weeklyClear(now), epochStart: undefined }, DEFAULT_PARAMS));
    expectParam(() => buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: { ...mandate(), approvedPlatforms: [] },
      platform,
      recipient,
      chainId: 31337,
      nonce: 1n,
    }));
    expectParam(() => buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: mandate(),
      platform: "not-an-address",
      recipient,
      chainId: 31337,
      nonce: 1n,
    }));
    const advance = {
      id: "1",
      vault,
      platform,
      navValue: "1",
      dueAt: now,
      status: "active" as const,
      cash: "1",
      vaultKind: "own-book" as const,
    };
    expectParam(() => planSweep({
      chainId: 31337,
      now,
      graceSeconds: 0,
      advances: Array.from({ length: 65 }, () => advance),
    }));
    expectParam(() => planSweep({ chainId: 31337, now, graceSeconds: 0, advances: [{ ...advance, status: "sold" }] }));
    expectParam(() => assessFacility({ now: -1 }));
    expectParam(() => assessFacility({ now, seniorAprBps: 10_001 }));
    expectParam(() => runCreTick({ chainId: 31337, now, params: DEFAULT_PARAMS, vaults: [], requests: [{ nonce: "1" }] }));
    expectParam(() => parseJson('{"nav":9007199254740993}'));
    expectParam(() => parseJson("{"));
  });

  it("rejects a malformed file on every command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lockgate-bad-"));
    const file = join(dir, "bad.json");
    const bad = async (command: string, body: string) => {
      writeFileSync(file, body);
      await expect(run([command, "--file", file])).rejects.toThrow();
    };
    await bad("quote", '{"kind":"epoch"}');
    await bad("score", '{"navValue":"nope"}');
    await bad("alerts", '{"input":{"kind":"epoch"}}');
    await bad("propose", '{"nonce":"1","chainId":"local"}');
    await bad("sweep", '{"chainId":31337,"now":1,"graceSeconds":0,"advances":[1]}');
    await bad("facility", '{"now":-1}');
    await bad("cre-tick", '{"chainId":31337,"vaults":[],"requests":[]}');
    await bad("cre-sweep", '{"chainId":31337,"schedule":"0 */10 * * * *"}');
    await expect(run(["quote"])).rejects.toBeInstanceOf(EngineError);
  });
});
