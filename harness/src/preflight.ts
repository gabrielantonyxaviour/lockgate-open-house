import { z } from "zod";
import { type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadArtifact } from "./artifacts.js";
import { failureBody, HarnessError, isTimeout } from "./errors.js";
import { ANVIL_CHAIN_ID, ARBITRUM_ONE, ARBITRUM_SEPOLIA, RPC_TIMEOUT_MS } from "./guards.js";
import { parseLocalDeployEnv, parseSepoliaEnv } from "./input.js";
import { ROLES } from "./roles.js";

/** Dust gate of 0.001 ETH. This is not a measured gas quote for the CREATE2 deploy. */
export const MIN_DEPLOYER_WEI = 10n ** 15n;

export const DEPLOY_ARTIFACTS = [
  "Create2Factory",
  "MockUSDG",
  "UsdgAdapter",
  "PricingEngine",
  "PlatformReserve",
  "LockgateCreditLine",
  "Router",
  "PartnerVaultImpl",
  "CreditLineBook",
  "CreditFacility",
  "ERC1967Proxy",
  "WeeklyImpl",
  "EpochImpl",
  "QuarterImpl",
  "FundFactory",
] as const;

const deployerSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const targetSchema = z.enum(["local", "sepolia"]);

export type PreflightTarget = "local" | "sepolia";

export type PreflightProbe = {
  chainId: () => Promise<number>;
  balanceOf: (address: Address) => Promise<bigint>;
};

export type PreflightReport = {
  ok: true;
  target: PreflightTarget;
  chainId: number;
  deployer: Address;
  balance: string;
  minBalance: string;
  artifactCount: number;
};

export type PreflightIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  probe?: (rpc: string) => PreflightProbe;
  load?: (logical: string) => void;
};

/**
 * Checks RPC reachability, chain id, deployer balance, then compiled artifacts.
 * An invalid deployer address is refused before the probe runs.
 */
export async function preflight(input: {
  target: PreflightTarget;
  deployer: string;
  probe: PreflightProbe;
  load?: (logical: string) => void;
  skipMockUsdg?: boolean;
  minBalanceWei?: bigint;
}): Promise<PreflightReport> {
  const deployer = deployerSchema.safeParse(input.deployer);
  if (!deployer.success) throw new HarnessError("Deployer address is invalid", "VALIDATION");
  const min = input.minBalanceWei ?? MIN_DEPLOYER_WEI;
  if (min < 0n) throw new HarnessError("Deployer balance floor is invalid", "VALIDATION");

  let chainId: number;
  try {
    chainId = await input.probe.chainId();
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError("RPC is unreachable", "RPC");
  }
  if (!Number.isInteger(chainId)) throw new HarnessError("RPC did not return a chain id", "RPC");
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  const expected = input.target === "local" ? ANVIL_CHAIN_ID : ARBITRUM_SEPOLIA;
  if (chainId !== expected) {
    const which = input.target === "local" ? "Local deploy requires chain 31337" : "Sepolia deploy requires chain 421614";
    throw new HarnessError(which, "CHAIN_REFUSED");
  }

  const address = deployer.data as Address;
  let balance: bigint;
  try {
    balance = await input.probe.balanceOf(address);
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError("Deployer balance could not be read", "RPC");
  }
  if (balance < min) throw new HarnessError("Deployer balance is below the 0.001 ETH floor", "UNFUNDED");

  const names = DEPLOY_ARTIFACTS.filter((name) => !(input.skipMockUsdg && name === "MockUSDG"));
  const load = input.load ?? ((logical: string) => {
    loadArtifact(logical);
  });
  for (const name of names) load(name);
  return {
    ok: true,
    target: input.target,
    chainId,
    deployer: address,
    balance: balance.toString(),
    minBalance: min.toString(),
    artifactCount: names.length,
  };
}

/** JSON-RPC probe used by the script and by deploy. Tests pass their own probe. */
export function fetchProbe(rpc: string): PreflightProbe {
  return {
    async chainId() {
      const result = await rpcResult(rpc, "eth_chainId", []);
      if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
        throw new HarnessError("RPC did not return a chain id", "RPC");
      }
      return Number.parseInt(result, 16);
    },
    async balanceOf(address) {
      const result = await rpcResult(rpc, "eth_getBalance", [address, "latest"]);
      if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
        throw new HarnessError("RPC did not return a balance", "RPC");
      }
      return BigInt(result);
    },
  };
}

async function rpcResult(rpc: string, method: string, params: readonly unknown[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) throw new HarnessError("RPC timed out", "RPC");
    throw new HarnessError("RPC is unreachable", "RPC");
  }
  if (!response.ok) throw new HarnessError(`RPC returned HTTP ${response.status}`, "RPC");
  const body = await response.json() as { result?: unknown };
  if (body.result === undefined) throw new HarnessError("RPC response has no result", "RPC");
  return body.result;
}

/**
 * CLI entry. Local env is checked before the probe. Sepolia checks the allow
 * flag and the key before the probe, and requires SEPOLIA_RPC so this command
 * does not fall back to the public Arbitrum Sepolia URL.
 */
export async function runPreflight(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Pick<PreflightIo, "probe" | "load"> = {},
): Promise<PreflightReport> {
  const target = targetSchema.safeParse(args[0] ?? "local");
  if (!target.success) throw new HarnessError("Preflight target is invalid", "VALIDATION");
  const probeFor = io.probe ?? fetchProbe;
  if (target.data === "local") {
    const parsed = parseLocalDeployEnv(env);
    return preflight({
      target: "local",
      deployer: ROLES.lockgate.address,
      probe: probeFor(parsed.rpc),
      load: io.load,
    });
  }
  const parsed = parseSepoliaEnv(env);
  if (!parsed.rpc) throw new HarnessError("SEPOLIA_RPC is required for preflight", "VALIDATION");
  return preflight({
    target: "sepolia",
    deployer: privateKeyToAccount(parsed.key).address,
    probe: probeFor(parsed.rpc),
    load: io.load,
    skipMockUsdg: parsed.paxos,
  });
}

export async function main(args: readonly string[], env: NodeJS.ProcessEnv, io: PreflightIo): Promise<number> {
  try {
    io.stdout(JSON.stringify(await runPreflight(args, env, io)));
    return 0;
  } catch (err: unknown) {
    io.stderr(JSON.stringify(failureBody(err)));
    return 1;
  }
}
