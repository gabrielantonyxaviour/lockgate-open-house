import { EngineError } from "../../errors.js";
import { mulDivCeil, toUsdg6 } from "../../money.js";
import { QUEUE } from "../../pricing/defaults.js";
import type { Address } from "../../domain.js";
import { asBigint, named, type ContractReader } from "../reader.js";
import { erc20Abi } from "../maple/abi.js";
import { stakedUsdaiAbi } from "./abi.js";

const WAD = 10n ** 18n;

export type UsdaiRead = {
  kind: "epoch";
  nextWindowAt: number;
  epochSeconds: number;
  pendingShares: bigint;
  queuedValue: bigint;
  cashAvailable: bigint;
  nav: bigint;
  sharePrice: bigint;
  assetDecimals: number;
  timestampWasPast: boolean;
  notes: string[];
};

/**
 * sUSDai redemption queue. Epoch length defaults to 30 days from the public docs
 * because the contract exposes the next timestamp, not the epoch length.
 * https://docs.usd.ai/depositor/susdai
 * https://github.com/usdai-foundation/usdai-contracts/blob/main/src/interfaces/IStakedUSDai.sol
 */
export async function readUsdai(
  reader: ContractReader,
  cfg: { staked: Address; asset: Address; epochSeconds?: number },
  now: number,
): Promise<UsdaiRead> {
  const epochSeconds = cfg.epochSeconds ?? QUEUE.epochSeconds;
  const info = await call(reader, cfg.staked, "redemptionQueueInfo");
  const pendingShares = asBigint(named(info, "pending", 3), "pending");
  const balance = asBigint(named(info, "balance", 4), "balance");
  const sharePrice = asBigint(await call(reader, cfg.staked, "redemptionSharePrice"), "price");
  const rawNav = asBigint(await call(reader, cfg.staked, "nav"), "nav");
  const stamp = Number(asBigint(await call(reader, cfg.staked, "redemptionTimestamp"), "timestamp"));
  const decimals = Number(asBigint(await reader.readContract({
    address: cfg.asset,
    abi: erc20Abi,
    functionName: "decimals",
  }), "decimals"));
  if (!Number.isSafeInteger(stamp)) throw new EngineError("rpc", "redemption timestamp overflow");
  let nextWindowAt = stamp;
  let timestampWasPast = false;
  if (stamp <= now) {
    timestampWasPast = true;
    const steps = Math.floor((now - stamp) / epochSeconds) + 1;
    nextWindowAt = stamp + steps * epochSeconds;
  }
  const queuedAssets = mulDivCeil(pendingShares, sharePrice, WAD);
  const notes = [
    "Loans are not called to pay exits. Cash is the redemption balance only.",
    "Day-29 cutoff is applied by the simulated epoch clock, not by this read.",
  ];
  if (timestampWasPast) notes.push("epoch-timestamp-in-past");
  return {
    kind: "epoch",
    nextWindowAt,
    epochSeconds,
    pendingShares,
    queuedValue: toUsdg6(queuedAssets, decimals, "ceil"),
    cashAvailable: toUsdg6(balance, decimals, "floor"),
    nav: toUsdg6(rawNav, decimals, "floor"),
    sharePrice,
    assetDecimals: decimals,
    timestampWasPast,
    notes,
  };
}

function call(reader: ContractReader, address: Address, functionName: string): Promise<unknown> {
  return reader.readContract({ address, abi: stakedUsdaiAbi, functionName });
}
