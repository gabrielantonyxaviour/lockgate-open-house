import { EngineError } from "./errors.js";

/**
 * Chains the sweeper and the proposal submitter must not transact on.
 * Reading public state is a separate path and is not blocked here.
 * Ethereum 1: https://ethereum.org/developers/docs/networks/
 * Arbitrum One 42161 and Sepolia 421614:
 * https://docs.arbitrum.io/build-decentralized-apps/reference/chain-information
 * Base 8453: https://docs.base.org/base-chain/network-information
 * OP 10, Polygon 137, BSC 56 and Avalanche 43114 are other networks named by
 * the Maple and Kasu deployments this engine can read. XDC 50 and Plume 98866
 * are Kasu deployments in the DefiLlama adapter.
 */
export const FORBIDDEN_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, 10, 50, 56, 137, 8453, 42161, 43114, 98866,
]);

export const LOCAL_ANVIL = 31337;
export const ARBITRUM_SEPOLIA = 421614;
export const ETHEREUM_SEPOLIA = 11155111;

/** Signing and broadcasting are allowlisted. A denylist would still sign on an unnamed mainnet. */
export const ALLOWED_CHAIN_IDS: ReadonlySet<number> = new Set([
  LOCAL_ANVIL,
  ARBITRUM_SEPOLIA,
  ETHEREUM_SEPOLIA,
]);

export function assertTransactableChain(chainId: number): void {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new EngineError("param", "chain id must be a positive integer");
  }
  if (!ALLOWED_CHAIN_IDS.has(chainId) || FORBIDDEN_CHAIN_IDS.has(chainId)) {
    throw new EngineError("mainnet-forbidden", `refusing to transact on chain ${chainId}`);
  }
}
