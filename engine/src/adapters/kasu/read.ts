import { EngineError } from "../../errors.js";
import { toUsdg6 } from "../../money.js";
import type { Address } from "../../domain.js";
import { asAddress, asBigint, named, scanBound, type ContractReader } from "../reader.js";
import { erc4626Abi, kasuPendingAbi, kasuSystemAbi } from "./abi.js";
import { isDepositNft } from "./ids.js";

export type KasuRead = {
  kind: "weekly-cycle";
  epochStart: number;
  epochSeconds: number;
  clearingSeconds: number;
  clearingNow: boolean;
  epochNumber: number;
  queuedShares: bigint;
  queuedValue: bigint | null;
  truncated: boolean;
  notes: string[];
};

export async function readKasu(
  reader: ContractReader,
  cfg: { systemVariables: Address; pendingPool: Address; assetDecimals: number; maxScan?: number },
): Promise<KasuRead> {
  const maxScan = scanBound(cfg.maxScan);
  const system = cfg.systemVariables;
  const epochNumber = asBigint(await read(reader, system, kasuSystemAbi, "currentEpochNumber"), "epoch");
  const epochSeconds = Number(asBigint(await read(reader, system, kasuSystemAbi, "epochDuration"), "duration"));
  const clearingSeconds = Number(asBigint(await read(reader, system, kasuSystemAbi, "clearingPeriodLength"), "clearing"));
  const epochStart = Number(asBigint(
    await read(reader, system, kasuSystemAbi, "epochStartTimestamp", [epochNumber]),
    "start",
  ));
  const clearingNow = Boolean(await read(reader, system, kasuSystemAbi, "isClearingTime"));
  const supply = asBigint(await read(reader, cfg.pendingPool, kasuPendingAbi, "totalSupply"), "supply");
  const limit = supply > BigInt(maxScan) ? BigInt(maxScan) : supply;
  const truncated = supply > limit;
  const sharesByTranche = new Map<Address, bigint>();
  let queuedShares = 0n;
  for (let i = 0n; i < limit; i++) {
    const id = asBigint(await read(reader, cfg.pendingPool, kasuPendingAbi, "tokenByIndex", [i]), "id");
    if (isDepositNft(id)) continue;
    const details = await read(reader, cfg.pendingPool, kasuPendingAbi, "trancheWithdrawalNftDetails", [id]);
    const shares = asBigint(named(details, "sharesAmount", 0), "shares");
    const tranche = asAddress(named(details, "tranche", 1), "tranche");
    queuedShares += shares;
    sharesByTranche.set(tranche, (sharesByTranche.get(tranche) ?? 0n) + shares);
  }
  const notes = [
    "Kasu withdrawal NFTs are non-transferable, so this reader only measures the queue.",
    "Shares ahead of a single NFT are not ordered on-chain; treat the rest of the queue as ahead.",
  ];
  if (truncated) notes.push("scan-truncated");
  let queuedValue: bigint | null = 0n;
  for (const [tranche, shares] of sharesByTranche) {
    try {
      const assets = asBigint(await read(reader, tranche, erc4626Abi, "convertToAssets", [shares]), "assets");
      queuedValue = (queuedValue ?? 0n) + toUsdg6(assets, cfg.assetDecimals, "ceil");
    } catch {
      queuedValue = null;
      notes.push(`unpriced-tranche:${tranche}`);
      break;
    }
  }
  if (!Number.isSafeInteger(epochStart) || !Number.isSafeInteger(epochSeconds)) {
    throw new EngineError("rpc", "Kasu epoch clock does not fit a safe integer");
  }
  return {
    kind: "weekly-cycle",
    epochStart,
    epochSeconds,
    clearingSeconds,
    clearingNow,
    epochNumber: Number(epochNumber),
    queuedShares,
    queuedValue,
    truncated,
    notes,
  };
}

function read(
  reader: ContractReader,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args?: readonly unknown[],
): Promise<unknown> {
  return reader.readContract({ address, abi, functionName, args });
}
