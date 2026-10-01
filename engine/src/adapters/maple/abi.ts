export const mapleQueueAbi = [
  {
    type: "function",
    name: "queue",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "nextRequestId", type: "uint256" },
      { name: "lastRequestId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "shares", type: "uint256" },
    ],
  },
] as const;

export const maplePoolAbi = [
  {
    type: "function",
    name: "convertToExitAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;
