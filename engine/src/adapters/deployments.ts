import type { Address } from "../domain.js";

/**
 * Read-only deployments. Bytecode was present on a public eth_call on 2026-10-01.
 * Kasu factory and system variables: DefiLlama adapter
 * https://github.com/DefiLlama/dimension-adapters/blob/master/fees/kasu.ts
 * The system-variables clock was checked live (epoch 604800, clearing 172800).
 * Pending pools are per lending strategy, not a singleton.
 * Maple: https://docs.maple.finance/integrate/ethereum-mainnet/smart-contract-integration
 * USD.AI tokens: https://docs.usd.ai/depositor/faq/usdai-and-susdai-101
 */
export const DEPLOYMENTS = {
  kasuBase: {
    chainId: 8453,
    systemVariables: "0x193Bb02A24F5562b58fEB86550e6f09Bb6c41f69" as Address,
    lendingPoolFactory: "0xd8c77e8882f9BAda35804625e8264E51cb905190" as Address,
  },
  mapleEthereumSyrupUsdc: {
    chainId: 1,
    pool: "0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b" as Address,
    withdrawalManager: "0x1bc47a0Dd0FdaB96E9eF982fdf1F34DC6207cfE3" as Address,
    asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  },
  mapleSepoliaSyrupUsdc: {
    chainId: 11155111,
    pool: "0x2d8D21FeE98d060655729eFD7b14bc432C375aC1" as Address,
    withdrawalManager: "0x2Ff61035dE7A1550219Be12a6e9D33AA10B844B6" as Address,
    asset: "0xC40E5D31187ae7AFC6238594765DA5873A5bB8ed" as Address,
  },
  usdaiArbitrum: {
    chainId: 42161,
    staked: "0x0B2b2B2076d95dda7817e785989fE353fe955ef9" as Address,
    asset: "0x0A1a1A107E45b7Ced86833863f482BC5f4ed82EF" as Address,
  },
} as const;
