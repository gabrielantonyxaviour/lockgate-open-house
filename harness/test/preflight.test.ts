import assert from "node:assert/strict";
import { test } from "node:test";
import { loadArtifact, protocolRoot } from "../src/artifacts.js";
import { HarnessError } from "../src/errors.js";
import { DEPLOY_ARTIFACTS, fetchProbe, main, MIN_DEPLOYER_WEI, type PreflightProbe } from "../src/preflight.js";
import { ROLES } from "../src/roles.js";

const localRpc = "http://127.0.0.1:8546";
const sepoliaRpc = "http://127.0.0.1:8546";

function funded(chainId: number, balance = MIN_DEPLOYER_WEI): PreflightProbe {
  return {
    chainId: async () => chainId,
    balanceOf: async () => balance,
  };
}

async function run(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  probe?: (rpc: string) => PreflightProbe,
  load?: (logical: string) => void,
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let dials = 0;
  const code = await main(args, env, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    probe: probe
      ? (rpc) => {
          dials += 1;
          return probe(rpc);
        }
      : () => {
          dials += 1;
          throw new Error("probe was not expected");
        },
    load,
  });
  const failure = stderr.length === 0 ? undefined : JSON.parse(stderr[0] ?? "{}") as { error?: string; code?: string };
  const report = stdout.length === 0 ? undefined : JSON.parse(stdout[0] ?? "{}") as { error?: string; artifactCount?: number };
  return { code, stdout, stderr, failure, report, dials };
}

test("local preflight prints the chain, the balance, and the artifact count", async () => {
  const loaded: string[] = [];
  const seen: string[] = [];
  const result = await run([], { HARNESS_RPC: localRpc }, (rpc) => {
    seen.push(rpc);
    return funded(31337, MIN_DEPLOYER_WEI + 1n);
  }, (name) => {
    loadArtifact(name);
    loaded.push(name);
  });
  assert.equal(result.code, 0);
  assert.equal(result.stderr.length, 0);
  assert.deepEqual(result.report, {
    ok: true,
    target: "local",
    chainId: 31337,
    deployer: ROLES.lockgate.address,
    balance: (MIN_DEPLOYER_WEI + 1n).toString(),
    minBalance: MIN_DEPLOYER_WEI.toString(),
    artifactCount: DEPLOY_ARTIFACTS.length,
  });
  assert.deepEqual(loaded, [...DEPLOY_ARTIFACTS]);
  assert.deepEqual(seen, [localRpc]);
  assert.equal(JSON.stringify(result.report).includes(ROLES.lockgate.key), false);
});

test("an unreachable RPC fails before the balance and the artifacts", async () => {
  const key = `0x${"ab".repeat(32)}`;
  let balanceReads = 0;
  let loads = 0;
  const result = await run([], { HARNESS_RPC: localRpc }, () => ({
    chainId: async () => {
      throw new Error(`connect ${key}`);
    },
    balanceOf: async () => {
      balanceReads += 1;
      return MIN_DEPLOYER_WEI;
    },
  }), () => {
    loads += 1;
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout.length, 0);
  assert.deepEqual(Object.keys(result.failure ?? {}).sort(), ["code", "error"]);
  assert.equal(result.failure?.code, "RPC");
  assert.equal(result.failure?.error, "RPC is unreachable");
  assert.equal(result.stderr[0]?.includes(key), false);
  assert.equal(balanceReads, 0);
  assert.equal(loads, 0);
});

test("chain 42161 is refused before the balance is read", async () => {
  let balanceReads = 0;
  const result = await run(["sepolia"], sepoliaEnv(), () => ({
    chainId: async () => 42161,
    balanceOf: async () => {
      balanceReads += 1;
      return MIN_DEPLOYER_WEI;
    },
  }));
  assert.equal(result.code, 1);
  assert.equal(result.failure?.code, "MAINNET_REFUSED");
  assert.equal(balanceReads, 0);
  assert.equal(result.stderr[0]?.includes(ROLES.lockgate.key), false);
});

test("a chain other than the target is refused before the balance is read", async () => {
  let balanceReads = 0;
  const local = await run([], { HARNESS_RPC: localRpc }, () => ({
    chainId: async () => 421614,
    balanceOf: async () => {
      balanceReads += 1;
      return MIN_DEPLOYER_WEI;
    },
  }));
  const sepolia = await run(["sepolia"], sepoliaEnv(), () => ({
    chainId: async () => 31337,
    balanceOf: async () => {
      balanceReads += 1;
      return MIN_DEPLOYER_WEI;
    },
  }));
  assert.equal(local.failure?.code, "CHAIN_REFUSED");
  assert.equal(sepolia.failure?.code, "CHAIN_REFUSED");
  assert.match(local.failure?.error ?? "", /31337/);
  assert.match(sepolia.failure?.error ?? "", /421614/);
  assert.equal(balanceReads, 0);
});

test("a balance under 0.001 ETH is UNFUNDED and does not load artifacts", async () => {
  let loads = 0;
  for (const balance of [0n, MIN_DEPLOYER_WEI - 1n]) {
    const result = await run([], { HARNESS_RPC: localRpc }, () => funded(31337, balance), () => {
      loads += 1;
    });
    assert.equal(result.code, 1);
    assert.equal(result.failure?.code, "UNFUNDED");
    assert.match(result.failure?.error ?? "", /0\.001 ETH/);
  }
  assert.equal(loads, 0);
});

test("a missing artifact is NOT_BUILT after the balance check", async () => {
  const result = await run([], { HARNESS_RPC: localRpc }, () => funded(31337), (name) => {
    if (name === "FundFactory") loadArtifact("NotAContract");
  });
  assert.equal(result.failure?.code, "NOT_BUILT");
  assert.equal(
    result.failure?.error,
    `Missing artifact NotAContract under ${protocolRoot}. Build contracts and harness/fixture first.`,
  );
});

test("the exact floor passes, and Paxos mode skips MockUSDG", async () => {
  const loaded: string[] = [];
  const result = await run(["sepolia"], sepoliaEnv({ USE_PAXOS_USDG: "1" }), (rpc) => {
    assert.equal(rpc, sepoliaRpc);
    return funded(421614, MIN_DEPLOYER_WEI);
  }, (name) => {
    loadArtifact(name);
    loaded.push(name);
  });
  assert.equal(result.code, 0);
  assert.equal(result.report?.artifactCount, DEPLOY_ARTIFACTS.length - 1);
  assert.equal(loaded.includes("MockUSDG"), false);
  assert.equal(loaded.includes("Create2Factory"), true);
  assert.equal(JSON.stringify(result.report).includes(ROLES.lockgate.key), false);
});

test("Sepolia preflight does not dial before the flag, the key, and SEPOLIA_RPC", async () => {
  const blocked = await run(["sepolia"], { SEPOLIA_RPC: sepoliaRpc });
  const shortKey = await run(["sepolia"], {
    LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
    DEPLOYER_PRIVATE_KEY: "0x1234",
    SEPOLIA_RPC: sepoliaRpc,
  });
  const noRpc = await run(["sepolia"], {
    LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
    DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
  });
  assert.equal(blocked.failure?.code, "SEPOLIA_BLOCKED");
  assert.equal(shortKey.failure?.code, "MISSING_ENV");
  assert.equal(noRpc.failure?.code, "VALIDATION");
  assert.match(noRpc.failure?.error ?? "", /SEPOLIA_RPC/);
  assert.equal(blocked.dials, 0);
  assert.equal(shortKey.dials, 0);
  assert.equal(noRpc.dials, 0);
  assert.equal(shortKey.stderr[0]?.includes("1234"), false);
  assert.equal(noRpc.stderr[0]?.includes(ROLES.lockgate.key), false);
});

test("local preflight refuses a public RPC and port 8545 before dialing", async () => {
  const publicRpc = await run([], { HARNESS_RPC: "https://arb1.arbitrum.io/rpc" });
  const shared = await run([], { HARNESS_RPC: "http://127.0.0.1:8545" });
  const badTarget = await run(["mainnet"], { HARNESS_RPC: localRpc });
  assert.equal(publicRpc.failure?.code, "CHAIN_REFUSED");
  assert.equal(shared.failure?.code, "PORT_RESERVED");
  assert.equal(badTarget.failure?.code, "VALIDATION");
  assert.equal(publicRpc.dials + shared.dials + badTarget.dials, 0);
});

test("a probe HTTP failure keeps the RPC code and drops a leaked key", async () => {
  const key = `0x${"cd".repeat(32)}`;
  const result = await run([], { HARNESS_RPC: localRpc }, () => ({
    chainId: async () => {
      throw new HarnessError(`RPC returned HTTP 500 for ${key}`, "RPC");
    },
    balanceOf: async () => MIN_DEPLOYER_WEI,
  }));
  assert.equal(result.failure?.code, "RPC");
  assert.equal(result.failure?.error?.includes(key), false);
  assert.match(result.failure?.error ?? "", /0x\[redacted\]/);
  assert.equal(result.stderr[0]?.includes("\n"), false);
});

test("fetchProbe reads a mocked chain id and balance", async () => {
  const calls: Array<{ url: string; method?: string; params?: unknown }> = [];
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string; params?: unknown };
    calls.push({ url: String(_url), method: body.method, params: body.params });
    const result = body.method === "eth_chainId" ? "0x7a69" : body.method === "eth_getBalance" ? "0xde0b6b3a7640000" : undefined;
    const payload = result === undefined
      ? { jsonrpc: "2.0", id: 1, error: { message: "unexpected" } }
      : { jsonrpc: "2.0", id: 1, result };
    return new Response(JSON.stringify(payload), { status: 200 });
  }, async () => {
    const probe = fetchProbe(localRpc);
    assert.equal(await probe.chainId(), 31337);
    assert.equal(await probe.balanceOf(ROLES.lockgate.address), 10n ** 18n);
  });
  assert.deepEqual(calls, [
    { url: localRpc, method: "eth_chainId", params: [] },
    { url: localRpc, method: "eth_getBalance", params: [ROLES.lockgate.address, "latest"] },
  ]);
});

test("fetchProbe maps a dead socket, an HTTP error, and a bad payload", async () => {
  const cases: Array<{ reject?: boolean; status?: number; body?: string; message: string }> = [
    { reject: true, message: "RPC is unreachable" },
    { status: 500, body: "{}", message: "RPC returned HTTP 500" },
    { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1 }), message: "RPC response has no result" },
    { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "nope" }), message: "RPC did not return a chain id" },
  ];
  for (const item of cases) {
    await withFetch(async () => {
      if (item.reject) throw new Error("connect ECONNREFUSED");
      return new Response(item.body ?? "", { status: item.status ?? 200 });
    }, async () => {
      await assert.rejects(() => fetchProbe(localRpc).chainId(), (err: unknown) => {
        return err instanceof HarnessError && err.code === "RPC" && err.message === item.message;
      });
    });
  }
});

async function withFetch(
  impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function sepoliaEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
    DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
    SEPOLIA_RPC: sepoliaRpc,
    ...extra,
  };
}
