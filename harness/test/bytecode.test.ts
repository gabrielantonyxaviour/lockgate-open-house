import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, http, type Hex } from "viem";
import { foundry } from "viem/chains";
import { loadDeployedBytecode, type ImmutableSpan } from "../src/artifacts.js";
import { diffBytecode, main, runBytecode } from "../src/bytecode.js";
import { deployProtocol } from "../src/deploy.js";
import { HarnessError } from "../src/errors.js";
import { type Manifest } from "../src/manifest.js";
import { withAnvil } from "./anvil.js";

const ONE = "0x1111111111111111111111111111111111111111";
const PUBLIC_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

function sheet(contracts: Record<string, string>, rpc = "http://127.0.0.1:8546", chainId = 31337): Manifest {
  return {
    mode: "protocol",
    chainId,
    rpc,
    artifactRoot: "contracts",
    factory: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    contracts,
    roles: { lockgate: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  };
}

function fillSpans(code: string, spans: readonly ImmutableSpan[]): Hex {
  const body = code.slice(2).split("");
  for (const span of spans) {
    const from = span.start * 2;
    const to = from + span.length * 2;
    for (let i = from; i < to; i += 1) body[i] = "f";
  }
  return `0x${body.join("")}`;
}

function flipOutside(code: string, spans: readonly ImmutableSpan[]): Hex {
  const body = code.slice(2).split("");
  const covered = new Array<boolean>(body.length).fill(false);
  for (const span of spans) {
    const from = span.start * 2;
    const to = from + span.length * 2;
    for (let i = from; i < to; i += 1) covered[i] = true;
  }
  const at = covered.findIndex((hit) => !hit);
  assert.ok(at >= 0);
  const current = body[at] ?? "0";
  body[at] = current === "0" ? "1" : "0";
  return `0x${body.join("")}`;
}

async function expectStale(manifest: Manifest, code: string, message: string): Promise<void> {
  await assert.rejects(
    () => diffBytecode(manifest, async () => code as Hex),
    (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "STALE");
      assert.equal(err.message, message);
      assert.equal(err.message.includes("0x"), false);
      return true;
    },
  );
}

async function guarded(run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetched");
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("immutable bytes still match, and a byte outside those spans is stale", async () => {
  const artifact = loadDeployedBytecode("UsdgAdapter");
  const manifest = sheet({ UsdgAdapter: ONE });
  const painted = fillSpans(artifact.bytecode, artifact.immutables);
  const report = await diffBytecode(manifest, async () => painted);
  assert.deepEqual(report, { ok: true, chainId: 31337, compared: 1, matched: 1 });
  assert.equal(JSON.stringify(report).includes(painted.slice(2, 18)), false);
  await expectStale(manifest, flipOutside(artifact.bytecode, artifact.immutables), "Stale bytecode: UsdgAdapter");
});

test("empty or invalid code is stale and names the contract", async () => {
  const manifest = sheet({ UsdgAdapter: ONE });
  for (const code of ["0x", "0x1", "0xzz"]) {
    await expectStale(manifest, code, "Stale bytecode: UsdgAdapter has no code");
  }
});

test("a long mismatch names four contracts and counts the rest", async () => {
  const names = ["MockUSDG", "UsdgAdapter", "PricingEngine", "PlatformReserve", "Router"];
  const contracts = Object.fromEntries(names.map((name) => [name, ONE]));
  await expectStale(
    sheet(contracts),
    "0x00",
    "Stale bytecode: MockUSDG, UsdgAdapter, PricingEngine, PlatformReserve and 1 more",
  );
});

test("the two partner vaults compare to the proxy", async () => {
  const proxy = loadDeployedBytecode("ERC1967Proxy").bytecode;
  const vault = loadDeployedBytecode("PartnerVault").bytecode;
  const impl = await diffBytecode(sheet({ PartnerVaultImpl: ONE }), async () => vault);
  assert.equal(impl.matched, 1);
  await expectStale(sheet({ PartnerVaultImpl: ONE }), proxy, "Stale bytecode: PartnerVaultImpl");
  const deployed = await diffBytecode(sheet({ PartnerVaultA: ONE, PartnerVaultB: ONE }), async () => proxy);
  assert.equal(deployed.compared, 2);
  assert.equal(deployed.matched, 2);
  await expectStale(sheet({ PartnerVaultA: ONE }), vault, "Stale bytecode: PartnerVaultA");
});

test("a public RPC and port 8545 are refused before a dial", async () => {
  await guarded(async () => {
    let calls = 0;
    const io = {
      chainId: async () => {
        calls += 1;
        return 31337;
      },
      codeAt: async () => {
        calls += 1;
        return "0x" as Hex;
      },
    };
    await assert.rejects(
      () => runBytecode({}, { ...io, manifest: sheet({ UsdgAdapter: ONE }, PUBLIC_RPC) }),
      (err: unknown) => {
        assert.ok(err instanceof HarnessError);
        assert.equal(err.code, "CHAIN_REFUSED");
        assert.equal(err.message, "Harness writes only reach a loopback Anvil");
        assert.equal(err.message.includes("sepolia-rollup"), false);
        return true;
      },
    );
    await assert.rejects(
      () => runBytecode({}, { ...io, manifest: sheet({ UsdgAdapter: ONE }, "http://127.0.0.1:8545") }),
      (err: unknown) => {
        assert.ok(err instanceof HarnessError);
        assert.equal(err.code, "PORT_RESERVED");
        assert.equal(err.message, "port 8545 belongs to the shared Anvil");
        return true;
      },
    );
    assert.equal(calls, 0);
  });
});

test("chain 42161 and a manifest chain mismatch are refused before code is read", async () => {
  let reads = 0;
  const codeAt = async () => {
    reads += 1;
    return "0x" as Hex;
  };
  await assert.rejects(
    () => runBytecode({}, { manifest: sheet({ UsdgAdapter: ONE }), chainId: async () => 42161, codeAt }),
    (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "MAINNET_REFUSED");
      assert.equal(err.message, "Arbitrum One is refused");
      return true;
    },
  );
  await assert.rejects(
    () => runBytecode({}, {
      manifest: sheet({ UsdgAdapter: ONE }, "http://127.0.0.1:8546", 421614),
      chainId: async () => 31337,
      codeAt,
    }),
    (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "CHAIN_REFUSED");
      assert.equal(err.message, "RPC chain 31337 does not match manifest 421614");
      return true;
    },
  );
  assert.equal(reads, 0);
});

test("a missing artifact is NOT_BUILT before a dial", async () => {
  let calls = 0;
  await assert.rejects(
    () => runBytecode({}, {
      manifest: sheet({ NotAContract: ONE }),
      chainId: async () => {
        calls += 1;
        return 31337;
      },
      codeAt: async () => {
        calls += 1;
        return "0x" as Hex;
      },
    }),
    (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "NOT_BUILT");
      assert.match(err.message, /^Missing artifact NotAContract under /);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("a closed loopback port is RPC and is not a hang", { timeout: 15_000 }, async () => {
  await assert.rejects(
    () => runBytecode({ HARNESS_RPC: "http://127.0.0.1:1" }, { manifest: sheet({ UsdgAdapter: ONE }) }),
    (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "RPC");
      assert.equal(err.message, "RPC is unreachable");
      return true;
    },
  );
});

test("main prints only error and code", async () => {
  const stderr: string[] = [];
  await guarded(async () => {
    const status = await main({}, {
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
      manifest: sheet({ UsdgAdapter: ONE }, "http://127.0.0.1:8545"),
    });
    assert.equal(status, 1);
  });
  assert.equal(stderr.length, 1);
  const body = JSON.parse(stderr[0] ?? "{}") as { error?: string; code?: string };
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
  assert.equal(body.code, "PORT_RESERVED");
  assert.equal(JSON.stringify(body).includes("0x"), false);
});

test("a fresh Anvil deploy matches the current artifacts", { timeout: 120_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    const manifest = await deployProtocol(rpc, manifestFile);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await main(
      { HARNESS_RPC: rpc, HARNESS_MANIFEST: manifestFile },
      { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) },
    );
    assert.equal(stderr.join("\n"), "");
    assert.equal(code, 0);
    assert.equal(stdout.length, 1);
    const report = JSON.parse(stdout[0] ?? "{}") as { ok?: boolean; chainId?: number; compared?: number; matched?: number };
    assert.deepEqual(Object.keys(report).sort(), ["chainId", "compared", "matched", "ok"]);
    assert.equal(report.ok, true);
    assert.equal(report.chainId, 31337);
    assert.equal(report.compared, 16);
    assert.equal(report.matched, 16);
    assert.equal(Object.keys(manifest.contracts).length, 16);
    const factory = manifest.contracts.Create2Factory ?? "";
    assert.match(factory, /^0x[0-9a-fA-F]{40}$/);
    const client = createPublicClient({ chain: foundry, transport: http(rpc) });
    const onChain = await client.getBytecode({ address: factory as `0x${string}` });
    assert.equal(onChain?.toLowerCase(), loadDeployedBytecode("Create2Factory").bytecode.toLowerCase());
    assert.equal(JSON.stringify(report).includes("0x"), false);
  });
});
