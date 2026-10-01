import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { run } from "../src/cli.js";
import { encodeJson } from "../src/json.js";
import { logEvent } from "../src/log.js";
import { advanceTypes } from "../src/proposal/typed.js";
import { EngineError } from "../src/errors.js";

const ANVIL = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("cli", () => {
  it("quotes an example and backtests a named scenario", async () => {
    const example = await run(["example", "--name", "epoch"]) as { input: { kind: string } };
    expect(example.input.kind).toBe("epoch");
    const dir = mkdtempSync(join(tmpdir(), "lockgate-"));
    const file = join(dir, "quote.json");
    writeFileSync(file, encodeJson(example));
    const quote = await run(["quote", "--file", file]) as { available: boolean; feeBps: number };
    expect(quote.available).toBe(true);
    expect(quote.feeBps).toBeGreaterThan(0);
    const report = await run(["backtest", "--scenario", "gated-refuse"]) as { refused: number };
    expect(report.refused).toBe(1);
  });

  it("signs from an env var without writing the key into the log", async () => {
    const example = await run(["example", "--name", "epoch"]) as object;
    const dir = mkdtempSync(join(tmpdir(), "lockgate-"));
    const file = join(dir, "propose.json");
    const platform = "0x00000000000000000000000000000000000000b1";
    const body = {
      ...example,
      platform,
      recipient: "0x00000000000000000000000000000000000000b2",
      chainId: 31337,
      nonce: "3",
      mandate: {
        vault: "0x00000000000000000000000000000000000000c1",
        partner: "0x00000000000000000000000000000000000000d1",
        signer: "0x00000000000000000000000000000000000000d1",
        approvedPlatforms: [platform],
        platformLimits: { [platform]: "100000000000" },
        minFeeBps: 10,
        maxTenorSeconds: 4_000_000,
        concentrationCapBps: 5000,
        expiresAt: 1_700_000_000 + 86_400,
        payoutTo: "0x00000000000000000000000000000000000000b2",
        idle: "50000000000",
        totalAssets: "100000000000",
      },
    };
    writeFileSync(file, encodeJson(body));
    process.env.LOCKGATE_TEST_PROPOSER = ANVIL;
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      logEvent("info", "probe", { privateKey: ANVIL, note: "ok" });
      const signed = await run(["propose", "--file", file, "--sign-env", "LOCKGATE_TEST_PROPOSER"]) as {
        signature: `0x${string}`;
        domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
        message: Record<string, unknown>;
        submittable: boolean;
      };
      expect(signed.submittable).toBe(true);
      const recovered = await recoverTypedDataAddress({
        domain: signed.domain,
        types: advanceTypes,
        primaryType: "AdvanceProposal",
        message: signed.message as never,
        signature: signed.signature,
      });
      expect(recovered).toBe(privateKeyToAccount(ANVIL).address);
    } finally {
      process.stderr.write = original;
      delete process.env.LOCKGATE_TEST_PROPOSER;
    }
    expect(chunks.join("")).not.toContain(ANVIL);
    expect(chunks.join("")).toContain("[redacted]");
    await expect(run(["nope"])).rejects.toBeInstanceOf(EngineError);
  });
});
