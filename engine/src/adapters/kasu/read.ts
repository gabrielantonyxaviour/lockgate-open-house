import { EngineError, guardRpc } from "../../errors.js";
import { toUsdg6 } from "../../money.js";
import type { Address } from "../../domain.js";
import { withPolicy } from "../policy.js";
import { asAddress, asBigint, named, scanBound, type ContractReader } from "../reader.js";
import { erc4626Abi, kasuPendingAbi, kasuSystemAbi, poolTokenAbi } from "./abi.js";
import { isDepositNft } from "./ids.js";

/**
 * Tranche `asset()` is the lending-pool token, and `LendingPool.decimals()` returns 6.
 * https://github.com/Kasu-Finance/kasu-contracts/blob/master/src/core/lendingPool/LendingPoolTranche.sol
 * https://github.com/Kasu-Finance/kasu-contracts/blob/master/src/core/lendingPool/LendingPool.sol
 * Decimals other than 6 are not priced as USDG. A 6-decimal pool is not proof the
 * payment token is USDC [U]: `_underlyingAsset` has no getter, and DefiLlama lists
 * pUSD and AUDD deployments beside USDC.
 * https://github.com/Kasu-Finance/kasu-contracts/blob/master/src/core/AssetFunctionsBase.sol
 * https://github.com/DefiLlama/dimension-adapters/blob/master/fees/kasu.ts
 */
const KASU_POOL_DECIMALS = 6;

export type KasuRead = {
  kind: "weekly-cycle";
  epochStart: number;
  epochSeconds: number;
  clearingSeconds: number;
  clearingNow: boolean;
  epochNumber: number;
  queuedShares: bigint;
  queuedValue: bigint | null;
  /** 6 when every priced tranche's pool token reported decimals 6. Null refuses the queue. */
  poolDecimals: 6 | null;
  truncated: boolean;
  notes: string[];
};

export function readKasu(
  reader: ContractReader,
  cfg: { systemVariables: Address; pendingPool: Address; maxScan?: number },
): Promise<KasuRead> {
  return guardRpc(() => readKasuUnsafe(reader, cfg));
}

async function readKasuUnsafe(
  reader: ContractReader,
  cfg: { systemVariables: Address; pendingPool: Address; maxScan?: number },
): Promise<KasuRead> {
  const paced = withPolicy(reader);
  const maxScan = scanBound(cfg.maxScan);
  const system = cfg.systemVariables;
  const epochNumber = asBigint(await read(paced, system, kasuSystemAbi, "currentEpochNumber"), "epoch");
  const epochSeconds = Number(asBigint(await read(paced, system, kasuSystemAbi, "epochDuration"), "duration"));
  const clearingSeconds = Number(asBigint(await read(paced, system, kasuSystemAbi, "clearingPeriodLength"), "clearing"));
  const epochStart = Number(asBigint(
    await read(paced, system, kasuSystemAbi, "epochStartTimestamp", [epochNumber]),
    "start",
  ));
  const clearingNow = Boolean(await read(paced, system, kasuSystemAbi, "isClearingTime"));
  const supply = asBigint(await read(paced, cfg.pendingPool, kasuPendingAbi, "totalSupply"), "supply");
  const limit = supply > BigInt(maxScan) ? BigInt(maxScan) : supply;
  const truncated = supply > limit;
  const sharesByTranche = new Map<Address, bigint>();
  let queuedShares = 0n;
  for (let i = 0n; i < limit; i++) {
    const id = asBigint(await read(paced, cfg.pendingPool, kasuPendingAbi, "tokenByIndex", [i]), "id");
    if (isDepositNft(id)) continue;
    const details = await read(paced, cfg.pendingPool, kasuPendingAbi, "trancheWithdrawalNftDetails", [id]);
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
  let poolDecimals: 6 | null = 6;
  for (const [tranche, shares] of sharesByTranche) {
    const priced = await priceTranche(paced, tranche, shares, notes);
    if (priced === null) {
      queuedValue = null;
      poolDecimals = null;
      break;
    }
    queuedValue = (queuedValue ?? 0n) + priced;
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
    poolDecimals,
    truncated,
    notes,
  };
}

async function priceTranche(
  reader: ContractReader,
  tranche: Address,
  shares: bigint,
  notes: string[],
): Promise<bigint | null> {
  try {
    const pool = asAddress(await read(reader, tranche, erc4626Abi, "asset"), "pool");
    const decimals = Number(asBigint(await read(reader, pool, poolTokenAbi, "decimals"), "decimals"));
    if (decimals !== KASU_POOL_DECIMALS) {
      notes.push(`pool-decimals:${tranche}:${decimals}`);
      return null;
    }
    const assets = asBigint(await read(reader, tranche, erc4626Abi, "convertToAssets", [shares]), "assets");
    return toUsdg6(assets, KASU_POOL_DECIMALS, "ceil");
  } catch {
    notes.push(`unpriced-tranche:${tranche}`);
    return null;
  }
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
