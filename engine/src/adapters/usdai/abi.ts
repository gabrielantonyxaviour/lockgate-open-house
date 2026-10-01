export const stakedUsdaiAbi = [
  {
    type: "function",
    name: "redemptionQueueInfo",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "index", type: "uint256" },
      { name: "head", type: "uint256" },
      { name: "tail", type: "uint256" },
      { name: "pending", type: "uint256" },
      { name: "balance", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "redemptionTimestamp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "timestamp", type: "uint64" }],
  },
  {
    type: "function",
    name: "redemptionSharePrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "price", type: "uint256" }],
  },
  {
    type: "function",
    name: "redemption",
    stateMutability: "view",
    inputs: [{ name: "redemptionId", type: "uint256" }],
    outputs: [
      {
        name: "item",
        type: "tuple",
        components: [
          { name: "prev", type: "uint256" },
          { name: "next", type: "uint256" },
          { name: "pendingShares", type: "uint256" },
          { name: "redeemableShares", type: "uint256" },
          { name: "withdrawableAmount", type: "uint256" },
          { name: "controller", type: "address" },
          { name: "redemptionTimestamp", type: "uint64" },
        ],
      },
      { name: "sharesAhead", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "nav",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "nav", type: "uint256" }],
  },
] as const;
