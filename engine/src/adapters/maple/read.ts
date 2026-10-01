import { toUsdg6 } from "../../money.js";
import type { Address } from "../../domain.js";
import { asAddress, asBigint, named, type ContractReader } from "../reader.js";
import { erc20Abi, maplePoolAbi, mapleQueueAbi } from "./abi.js";

export type MapleRead = {
  kind: "fifo-open";
  nextRequestId: bigint;
  lastRequestId: bigint;
  queuedShares: bigint;
  queuedValue: bigint | null;
  totalAssets: bigint | null;
  assetDecimals: number;
  truncated: boolean;
  cashKnown: false;
  notes: string[];
};

/**
 * Maple's queue contract reports lockedLiquidity as zero: idle cash is the
 * delegate's choice, not a view the engine can treat as committed.
 * https://docs.maple.finance/technical-resources/withdrawal-managers/withdrawal-manager-queue
 */
export async function readMaple(
  reader: ContractReader,
  cfg: { pool: Address; withdrawalManager: Address; asset: Address; maxScan?: number },
): Promise<MapleRead> {
  const maxScan = cfg.maxScan ?? 100;
  const head = await reader.readContract({
    address: cfg.withdrawalManager,
    abi: mapleQueueAbi,
    functionName: "queue",
  });
  const nextRequestId = asBigint(named(head, "nextRequestId", 0), "next");
  const lastRequestId = asBigint(named(head, "lastRequestId", 1), "last");
  const decimals = Number(asBigint(await reader.readContract({
    address: cfg.asset,
    abi: erc20Abi,
    functionName: "decimals",
  }), "decimals"));
  const notes = [
    "cashKnown is false: Maple documents lockedLiquidity as zero, and a 30-day maximum.",
  ];
  const empty = nextRequestId > lastRequestId;
  const span = empty ? 0n : lastRequestId - nextRequestId + 1n;
  const truncated = span > BigInt(maxScan);
  let queuedShares = 0n;
  if (!empty && !truncated) {
    for (let id = nextRequestId; id <= lastRequestId; id++) {
      const row = await reader.readContract({
        address: cfg.withdrawalManager,
        abi: mapleQueueAbi,
        functionName: "requests",
        args: [id],
      });
      asAddress(named(row, "owner", 0), "owner");
      queuedShares += asBigint(named(row, "shares", 1), "shares");
    }
  }
  if (truncated) notes.push("scan-truncated");
  const queuedValue = truncated ? null : await exitAssets(reader, cfg.pool, queuedShares, decimals);
  let totalAssets: bigint | null = null;
  try {
    const raw = asBigint(await reader.readContract({
      address: cfg.pool,
      abi: maplePoolAbi,
      functionName: "totalAssets",
    }), "assets");
    totalAssets = toUsdg6(raw, decimals);
  } catch {
    notes.push("total-assets-unread");
  }
  return {
    kind: "fifo-open",
    nextRequestId,
    lastRequestId,
    queuedShares,
    queuedValue,
    totalAssets,
    assetDecimals: decimals,
    truncated,
    cashKnown: false,
    notes,
  };
}

async function exitAssets(reader: ContractReader, pool: Address, shares: bigint, decimals: number): Promise<bigint> {
  if (shares === 0n) return 0n;
  const assets = asBigint(await reader.readContract({
    address: pool,
    abi: maplePoolAbi,
    functionName: "convertToExitAssets",
    args: [shares],
  }), "exit");
  return toUsdg6(assets, decimals);
}
