import { type Address } from "viem";
import { read, send, warpTo, type Ctx } from "../chain.js";
import { feeFromBps, modelFeeBps } from "../model.js";
import { ROLES } from "../roles.js";
import { parseUsdg } from "../units.js";
import { approve, balanceOf, expect, expectRevert } from "./common.js";

type Quote = { navValue: bigint; fee: bigint; available: boolean; reason: string };
type Position = { navValue: bigint; fee: bigint; advanceId: bigint; readyAt: bigint; settled: boolean };

/** Door 2. Lockgate buys open-token shares from its own book. The partner vault is not touched. */
export async function door2Cycle(ctx: Ctx, input: Record<string, string> = {}): Promise<unknown> {
  const amount = parseUsdg(input.amountUsdg ?? "1000");
  const pool = ctx.binding("LockgateExitPool").address;
  const idleBefore = await read<bigint>(ctx, "PartnerVaultA", "idle");
  await send(ctx, "lockgate", "LockgateCreditLine", "registerSource", [
    pool, parseUsdg(input.limitUsdg ?? "25000"), 0,
  ]);
  const reserveBps = await read<number>(ctx, "LockgateCreditLine", "reserveBpsOf", [pool]);
  expect(Number(reserveBps) === 0, "exit pool reserve bps was not 0", reserveBps);

  await approve(ctx, "investor", "OpenCreditVault", amount);
  await send(ctx, "investor", "OpenCreditVault", "deposit", [amount]);
  const shares = await read<bigint>(ctx, "OpenCreditVault", "balanceOf", [ROLES.investor.address]);
  expect(shares > 0n, "open vault minted no shares");

  await send(ctx, "lockgate", "LockgateExitPool", "setGated", [true]);
  await expectRevert(() => send(ctx, "investor", "LockgateExitPool", "sellToLockgate", [shares, 0n]), "Gated");
  await send(ctx, "lockgate", "LockgateExitPool", "setGated", [false]);

  const cooldown = await read<bigint>(ctx, "OpenCreditVault", "cooldown");
  const bps = modelFeeBps(cooldown);
  const quoted = asQuote(await read(ctx, "LockgateExitPool", "quote", [shares]));
  expect(cooldown === 300n && bps === 49, "5-minute cooldown did not price at 49 bps", { cooldown: cooldown.toString(), bps });
  expect(quoted.available, "door 2 quote unavailable", quoted.reason);
  expect(quoted.fee === feeFromBps(quoted.navValue, bps), "door 2 fee diverged from the stage-1 curve", quoted);

  const sellerBefore = await balanceOf(ctx, ROLES.investor.address);
  await send(ctx, "investor", "OpenCreditVault", "approve", [pool, shares]);
  await send(ctx, "investor", "LockgateExitPool", "sellToLockgate", [shares, 0n]);
  const sellerAfter = await balanceOf(ctx, ROLES.investor.address);
  const positionId = await read<bigint>(ctx, "LockgateExitPool", "positionCount");
  const position = asPosition(await read(ctx, "LockgateExitPool", "getPosition", [positionId]));
  expect(sellerAfter - sellerBefore === position.navValue - position.fee, "seller did not receive nav minus fee");
  expect(position.fee === feeFromBps(position.navValue, bps), "sold fee diverged", position);
  expect(!position.settled, "position settled in the sell block");

  await expectRevert(() => send(ctx, "lockgate", "LockgateExitPool", "settle", [positionId]), "NotReady");
  await warpTo(ctx, position.readyAt);
  const block = await ctx.publicClient.getBlock();
  if (block.timestamp < position.readyAt) await warpTo(ctx, position.readyAt + 1n);
  await send(ctx, "lockgate", "LockgateExitPool", "settle", [positionId]);
  const settled = asPosition(await read(ctx, "LockgateExitPool", "getPosition", [positionId]));
  const remaining = await read<bigint>(ctx, "LockgateCreditLine", "remainingOf", [position.advanceId]);
  const idleAfter = await read<bigint>(ctx, "PartnerVaultA", "idle");
  expect(settled.settled, "position was not settled");
  expect(remaining === 0n, "door 2 advance was not repaid", remaining.toString());
  expect(idleAfter === idleBefore, "door 2 moved partner cash", {
    idleBefore: idleBefore.toString(), idleAfter: idleAfter.toString(),
  });
  return { positionId: positionId.toString(), nav: position.navValue.toString(), fee: position.fee.toString(), feeBps: bps };
}

function asQuote(value: unknown): Quote {
  const row = value as Partial<Quote>;
  if (row && typeof row === "object" && "navValue" in row) {
    return {
      navValue: BigInt(row.navValue ?? 0), fee: BigInt(row.fee ?? 0),
      available: Boolean(row.available), reason: String(row.reason ?? ""),
    };
  }
  const parts = Array.isArray(value) ? value : [];
  return {
    navValue: BigInt(parts[0] ?? 0), fee: BigInt(parts[1] ?? 0),
    available: Boolean(parts[3]), reason: String(parts[4] ?? ""),
  };
}

function asPosition(value: unknown): Position {
  const row = value as Partial<Position>;
  if (row && typeof row === "object" && "advanceId" in row) {
    return {
      navValue: BigInt(row.navValue ?? 0), fee: BigInt(row.fee ?? 0),
      advanceId: BigInt(row.advanceId ?? 0), readyAt: BigInt(row.readyAt ?? 0), settled: Boolean(row.settled),
    };
  }
  const parts = Array.isArray(value) ? value : [];
  return {
    navValue: BigInt(parts[2] ?? 0), fee: BigInt(parts[3] ?? 0),
    advanceId: BigInt(parts[5] ?? 0), readyAt: BigInt(parts[6] ?? 0), settled: Boolean(parts[7]),
  };
}
