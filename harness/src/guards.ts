import { HarnessError } from "./errors.js";

export const ANVIL_CHAIN_ID = 31337;
export const ARBITRUM_ONE = 42161;
export const ARBITRUM_SEPOLIA = 421614;

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
