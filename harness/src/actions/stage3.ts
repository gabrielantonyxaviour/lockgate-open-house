import { read, send, warpTo, type Ctx } from "../chain.js";
import { parseUsdg } from "../units.js";
import { ROLES } from "../roles.js";
import { approve } from "./common.js";

export type Books = {
  drawn: bigint;
  seniorPrincipal: bigint;
  juniorPrincipal: bigint;
  seniorInterestDue: bigint;
  recovery: boolean;
};

export async function approveLenders(ctx: Ctx): Promise<unknown> {
  await send(ctx, "lockgate", "CreditFacility", "approveLender", [ROLES.senior.address, true]);
  await send(ctx, "lockgate", "CreditFacility", "approveLender", [ROLES.junior.address, true]);
  return { senior: true, junior: true };
}

export async function depositSenior(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  return depositTranche(ctx, "senior", 0, input.amountUsdg ?? "10000");
}

export async function depositJunior(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  return depositTranche(ctx, "junior", 1, input.amountUsdg ?? "4000");
}

export async function drawFacility(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const amount = parseUsdg(input.amountUsdg ?? "2000");
  const hash = await send(ctx, "lockgate", "CreditFacility", "draw", [amount]);
  return { hash, amount: amount.toString() };
}

export async function repayFacility(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const amount = parseUsdg(input.amountUsdg ?? "10");
  await approve(ctx, "lockgate", "CreditFacility", amount);
  const hash = await send(ctx, "lockgate", "CreditFacility", "repay", [amount]);
  return { hash, amount: amount.toString() };
}

export async function recognizeLoss(ctx: Ctx): Promise<unknown> {
  await send(ctx, "lockgate", "CreditFacility", "poke", []);
  const hash = await send(ctx, "lockgate", "CreditFacility", "recognizeLoss", []);
  return { hash, books: await books(ctx) };
}

export async function waterfall(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  if (input.warpDays && input.warpDays !== "0") {
    const block = await ctx.publicClient.getBlock();
    await warpTo(ctx, block.timestamp + BigInt(input.warpDays) * 86_400n);
  }
  const before = await books(ctx);
  const seniorBefore = await read<bigint>(ctx, "MockUSDG", "balanceOf", [ROLES.senior.address]);
  const repaid = await repayFacility(ctx, input);
  await send(ctx, "senior", "CreditFacility", "withdrawInterest", [0]);
  const seniorAfter = await read<bigint>(ctx, "MockUSDG", "balanceOf", [ROLES.senior.address]);
  const after = await books(ctx);
  return {
    repaid,
    seniorInterestBefore: before.seniorInterestDue.toString(),
    seniorInterestAfter: after.seniorInterestDue.toString(),
    seniorGain: (seniorAfter - seniorBefore).toString(),
  };
}

export async function books(ctx: Ctx): Promise<Books> {
  const state = await read<Books>(ctx, "CreditFacility", "accounting");
  return {
    drawn: BigInt(state.drawn),
    seniorPrincipal: BigInt(state.seniorPrincipal),
    juniorPrincipal: BigInt(state.juniorPrincipal),
    seniorInterestDue: BigInt(state.seniorInterestDue),
    recovery: Boolean(state.recovery),
  };
}

export async function borrowingBase(ctx: Ctx): Promise<bigint> {
  return read<bigint>(ctx, "CreditFacility", "borrowingBase");
}

async function depositTranche(ctx: Ctx, role: "senior" | "junior", tranche: number, amountText: string): Promise<unknown> {
  const amount = parseUsdg(amountText);
  await send(ctx, "lockgate", "CreditFacility", "approveLender", [ROLES[role].address, true]);
  await approve(ctx, role, "CreditFacility", amount);
  const hash = await send(ctx, role, "CreditFacility", "deposit", [tranche, amount]);
  return { hash, tranche, amount: amount.toString() };
}
