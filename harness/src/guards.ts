import { HarnessError } from "./errors.js";

export const ANVIL_CHAIN_ID = 31337;
export const ARBITRUM_ONE = 42161;
export const ARBITRUM_SEPOLIA = 421614;

/** One JSON-RPC attempt. A hang becomes `RPC` after this, with no retry. */
export const RPC_TIMEOUT_MS = 2_000;

/** Paxos Global Dollar on Arbitrum Sepolia, 6 decimals. */
export const PAXOS_USDG_SEPOLIA = "0xFFC95faa3d63Cde504a05B567C600B78C0b41892";

export function assertHarnessWrite(chainId: number): void {
  if (chainId === ARBITRUM_ONE) {
    throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  }
  if (chainId !== ANVIL_CHAIN_ID) {
    throw new HarnessError("Harness state changes run only on local Anvil (chain 31337)", "CHAIN_REFUSED");
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Harness writes use a loopback Anvil. Port 8545 is the shared node and is refused. */
export function assertLocalRpc(rpc: string): void {
  let url: URL;
  try {
    url = new URL(rpc);
  } catch {
    throw new HarnessError("RPC URL is invalid", "CHAIN_REFUSED");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HarnessError("RPC URL must be http on loopback", "CHAIN_REFUSED");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(host)) {
    throw new HarnessError("Harness writes only reach a loopback Anvil", "CHAIN_REFUSED");
  }
  if (!url.port) throw new HarnessError("RPC URL needs an explicit port", "CHAIN_REFUSED");
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HarnessError("RPC port is invalid", "CHAIN_REFUSED");
  }
  if (port === 8545) throw new HarnessError("port 8545 belongs to the shared Anvil", "PORT_RESERVED");
}

/** Decimal text only. `08545` is port 8545, not a different port. */
export function assertAnvilPort(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) throw new HarnessError("Anvil port must be an integer", "VALIDATION");
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new HarnessError("Anvil port is out of range", "VALIDATION");
  }
  if (port === 8545) throw new HarnessError("port 8545 belongs to the shared Anvil", "PORT_RESERVED");
  return port;
}

export function assertSepoliaBroadcast(chainId: number, env: NodeJS.ProcessEnv): HexKey {
  if (chainId === ARBITRUM_ONE) {
    throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  }
  if (chainId !== ARBITRUM_SEPOLIA) {
    throw new HarnessError(`Sepolia deploy requires chain ${ARBITRUM_SEPOLIA}, got ${chainId}`, "CHAIN_REFUSED");
  }
  if (env.LOCKGATE_ALLOW_SEPOLIA_DEPLOY !== "1") {
    throw new HarnessError(
      "Sepolia broadcast is blocked until LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1 is set in the environment",
      "SEPOLIA_BLOCKED",
    );
  }
  const key = env.DEPLOYER_PRIVATE_KEY ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new HarnessError("DEPLOYER_PRIVATE_KEY must be a 32-byte hex string from the environment", "MISSING_ENV");
  }
  return key as HexKey;
}

type HexKey = `0x${string}`;
