import { formatEther } from "viem";
import { read, type Ctx } from "../chain.js";
import { ROLES, type RoleName } from "../roles.js";
import { formatUsdg } from "../units.js";
import { books, borrowingBase } from "./stage3.js";

export async function status(ctx: Ctx): Promise<unknown> {
  const weekly = ctx.manifest.contracts.WeeklyQueuePlatform;
  const line = "LockgateCreditLine";
  const balances: Record<string, string> = {};
  for (const role of Object.keys(ROLES) as RoleName[]) {
    balances[role] = formatUsdg(await read<bigint>(ctx, "MockUSDG", "balanceOf", [ROLES[role].address]));
  }
  const account = await books(ctx);
  return {
    mode: ctx.manifest.mode,
    chainId: ctx.chainId,
    contracts: ctx.manifest.contracts,
    capital: formatUsdg(await read<bigint>(ctx, line, "capital")),
    outstanding: formatUsdg(await read<bigint>(ctx, line, "outstanding")),
    utilizationBps: Number(await read(ctx, line, "utilizationBps")),
    earnedFees: formatUsdg(await read<bigint>(ctx, line, "earnedFees")),
    paused: await read<boolean>(ctx, line, "paused"),
    weeklyReserve: weekly ? formatUsdg(await read<bigint>(ctx, line, "reserveOf", [weekly])) : null,
    weeklyNextWindow: weekly ? (await read<bigint>(ctx, "WeeklyQueuePlatform", "nextWindow")).toString() : null,
    vaultAIdle: formatUsdg(await read<bigint>(ctx, "PartnerVaultA", "idle")),
    vaultAOwner: await read(ctx, "PartnerVaultA", "owner"),
    vaultBIdle: formatUsdg(await read<bigint>(ctx, "PartnerVaultB", "idle")),
    facilityDrawn: formatUsdg(account.drawn),
    facilityRecovery: account.recovery,
    borrowingBase: formatUsdg(await borrowingBase(ctx)),
    balances,
    lockgateEth: formatEther(await ctx.publicClient.getBalance({ address: ROLES.lockgate.address })),
  };
}
