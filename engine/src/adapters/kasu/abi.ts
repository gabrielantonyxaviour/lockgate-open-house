export const kasuSystemAbi = [
  {
    type: "function",
    name: "currentEpochNumber",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "epoch", type: "uint256" }],
  },
  {
    type: "function",
    name: "epochDuration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "seconds", type: "uint256" }],
  },
  {
    type: "function",
    name: "clearingPeriodLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "seconds", type: "uint256" }],
  },
  {
    type: "function",
    name: "epochStartTimestamp",
    stateMutability: "view",
    inputs: [{ name: "epoch", type: "uint256" }],
    outputs: [{ name: "timestamp", type: "uint256" }],
  },
  {
    type: "function",
    name: "isClearingTime",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "clearing", type: "bool" }],
  },
] as const;

export const kasuPendingAbi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "supply", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenByIndex",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "trancheWithdrawalNftDetails",
    stateMutability: "view",
    inputs: [{ name: "wNftId", type: "uint256" }],
    outputs: [
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "sharesAmount", type: "uint256" },
          { name: "tranche", type: "address" },
          { name: "epochId", type: "uint64" },
          { name: "priority", type: "uint8" },
          { name: "requestedFrom", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export const erc4626Abi = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "assetToken", type: "address" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

/** Lending-pool token. Kasu hardcodes this token at 6 decimals. */
export const poolTokenAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;
