import { keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { read, send, type Ctx } from "../chain.js";
import { assertProposalShape, proposalTuple, signProposal, type AdvanceProposal } from "../eip712.js";
import { HarnessError } from "../errors.js";
import { DEMO } from "../params.js";
import { ROLES } from "../roles.js";
import { parseBps, parseUsdg } from "../units.js";
import { approve, expect, expectRevert, same, vaultRole } from "./common.js";

type Slice = { vault: Address; navValue: bigint; fee: bigint; feeBps: number };

export async function setMandate(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const vault = input.vault ?? "PartnerVaultA";
  const block = await ctx.publicClient.getBlock();
  const expiry = block.timestamp + 30n * 86_400n;
  await send(ctx, vaultRole(vault), vault, "setMandate", [
    parseBps(input.minFeeBps ?? "25"),
    7n * 86_400n,
    parseBps(input.concentrationBps ?? "5000"),
    expiry,
  ]);
  return { vault, expiry: expiry.toString() };
}

export async function approvePlatform(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const vault = input.vault ?? "PartnerVaultA";
  const platform = input.platform ?? "WeeklyQueuePlatform";
  const role = vaultRole(vault);
  const platformAddress = ctx.binding(platform).address;
  await send(ctx, role, vault, "setPlatform", [
    platformAddress,
    input.approved !== "false",
    parseUsdg(input.limitUsdg ?? "20000"),
    parseBps(input.reserveBps ?? "500"),
    input.checkGate !== "false",
    BigInt(DEMO.maxNavAge),
  ]);
  await send(ctx, role, vault, "setPayout", [platformAddress, ROLES.platform.address]);
  await send(ctx, role, vault, "setProposer", [ROLES.lockgate.address]);
  await send(ctx, role, vault, "setRouter", [ctx.binding("Router").address]);
  return { vault, platform };
}

export async function depositVault(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const vault = input.vault ?? "PartnerVaultA";
  const amount = parseUsdg(input.amountUsdg ?? "20000");
  await approve(ctx, vaultRole(vault), vault, amount);
  const hash = await send(ctx, vaultRole(vault), vault, "deposit", [amount]);
  return { hash, amount: amount.toString() };
}

export async function postVaultReserve(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const vault = input.vault ?? "PartnerVaultA";
  const amount = parseUsdg(input.amountUsdg ?? "200");
  const platform = ctx.binding(input.platform ?? "WeeklyQueuePlatform").address;
  await approve(ctx, vaultRole(vault), vault, amount);
  const hash = await send(ctx, vaultRole(vault), vault, "postReserve", [platform, amount]);
  return { hash };
}

export async function enlist(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const vault = input.vault ?? "PartnerVaultA";
  const address = ctx.binding(vault).address;
  // Lockgate vets the vault for the directory; the partner then lists it. Neither step touches vault funds.
  if (!(await read<boolean>(ctx, "Router", "approvedVault", [address]))) {
    await send(ctx, "lockgate", "Router", "approveVault", [address, true]);
  }
  const hash = await send(ctx, vaultRole(vault), "Router", "register", [address]);
  return { hash, vault };
}

export async function setPolicy(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  void ctx;
  return {
    stored: false,
    strategy: Number(input.policy ?? "0"),
    note: "PartnerRouter takes the strategy on each quote. It does not store a policy.",
  };
}

export async function preview(ctx: Ctx, input: Record<string, string>): Promise<{ slices: Slice[]; exitRef: Hex; dueAt: string }> {
  const built = await exitRequest(ctx, input);
  const slices = asSlices(await read(ctx, "Router", "quote", [built.request, Number(input.strategy ?? "0")]));
  return { slices, exitRef: built.exitRef, dueAt: built.dueAt.toString() };
}

export async function routedAdvance(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const drafted = await draftProposal(ctx, input);
  const engineSig = await signProposal(ctx.wallet("lockgate"), drafted.proposal, ctx.chainId, drafted.slice.vault);
  if (input.rejectLockgate === "true") {
    const forged = await signProposal(ctx.wallet("lockgate"), drafted.proposal, ctx.chainId, drafted.slice.vault);
    await expectRevert(
      () => send(ctx, "investor", drafted.vault, "execute", [proposalTuple(drafted.proposal), engineSig, forged]),
      "NotApproved",
    );
  }
  const partnerSig = await signProposal(ctx.wallet(vaultRole(drafted.vault)), drafted.proposal, ctx.chainId, drafted.slice.vault);
  const hash = await send(ctx, "investor", drafted.vault, "execute", [proposalTuple(drafted.proposal), engineSig, partnerSig]);
  return funded(ctx, drafted, hash);
}

/** Engine `submitProposal`, then the partner `approve`. Lockgate's approve does not pay. */
export async function approveProposal(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const drafted = await draftProposal(ctx, input);
  const engineSig = await signProposal(ctx.wallet("lockgate"), drafted.proposal, ctx.chainId, drafted.slice.vault);
  const filed = await send(ctx, "lockgate", drafted.vault, "submitProposal", [proposalTuple(drafted.proposal), engineSig]);
  const idle = await read<bigint>(ctx, drafted.vault, "idle");
  if (input.rejectLockgate === "true") {
    await expectRevert(
      () => send(ctx, "lockgate", drafted.vault, "approve", [proposalTuple(drafted.proposal)]),
      "NotApproved",
    );
    expect((await read<bigint>(ctx, drafted.vault, "idle")) === idle, "a rejected approve moved cash");
  }
  const hash = await send(ctx, vaultRole(drafted.vault), drafted.vault, "approve", [proposalTuple(drafted.proposal)]);
  return { ...await funded(ctx, drafted, hash), submitted: filed };
}

export async function repayRoute(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const exitRef = input.exitRef as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(exitRef ?? "")) throw new HarnessError("exitRef is required", "VALIDATION");
  const index = BigInt(input.recordIndex ?? "0");
  const records = await read<Array<{ vault: Address; advanceId: bigint }>>(ctx, "Router", "recordsOf", [exitRef]);
  const record = records[Number(index)];
  if (!record) throw new HarnessError("No route record", "ASSERTION");
  const vault = logicalVault(ctx, record.vault);
  const owed = await read<bigint>(ctx, vault, "owedOf", [record.advanceId]);
  await approve(ctx, "platform", "Router", owed);
  const hash = await send(ctx, "platform", "Router", "relayRepay", [exitRef, index]);
  return { hash, owed: owed.toString(), vault };
}

export async function payInvestor(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const amount = parseUsdg(input.amountUsdg ?? "1");
  const hash = await send(ctx, "platform", "MockUSDG", "transfer", [ROLES.investor.address, amount]);
  return { hash, amount: amount.toString() };
}

export async function proposeUpgrade(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const vault = input.vault ?? "PartnerVaultA";
  const hash = await send(ctx, vaultRole(vault), vault, "scheduleUpgrade", [ctx.binding("PartnerVaultImpl").address]);
  const eta = await read<bigint>(ctx, vault, "scheduledEta");
  return { hash, eta: eta.toString() };
}

export async function assertLockgateHasNoControl(ctx: Ctx): Promise<unknown> {
  const owner = await read<Address>(ctx, "PartnerVaultA", "owner");
  expect(!same(owner, ROLES.lockgate.address), "Lockgate is the vault owner", owner);
  await expectRevert(() => send(ctx, "lockgate", "PartnerVaultA", "withdraw", [1n, ROLES.lockgate.address]), "Unauthorized");
  await expectRevert(() => send(ctx, "lockgate", "PartnerVaultA", "setPaused", [true]), "Unauthorized");
  await expectRevert(() => send(ctx, "lockgate", "PartnerVaultA", "setMandate", [1, 1, 1, 1]), "Unauthorized");
  await expectRevert(
    () => send(ctx, "lockgate", "Router", "register", [ctx.binding("PartnerVaultA").address]),
    "NotOwner",
  );
  return { owner, lockgateCanMoveFunds: false };
}

export async function setPaused(ctx: Ctx, vault: string, paused: boolean): Promise<void> {
  await send(ctx, vaultRole(vault), vault, "setPaused", [paused]);
}

export async function draftProposal(ctx: Ctx, input: Record<string, string>): Promise<{
  proposal: AdvanceProposal; slice: Slice; vault: string; exitRef: Hex;
}> {
  const looked = await preview(ctx, input);
  const slice = looked.slices[0];
  if (!slice) throw new HarnessError("No vault accepted the exit", "ASSERTION");
  const vault = logicalVault(ctx, slice.vault);
  const nonce = BigInt(input.nonce ?? "1");
  const block = await ctx.publicClient.getBlock();
  const proposal: AdvanceProposal = {
    platform: ctx.binding(input.platform ?? "WeeklyQueuePlatform").address,
    recipient: ROLES.platform.address,
    requestId: nonce,
    navValue: slice.navValue,
    fee: slice.fee,
    payout: slice.navValue - slice.fee,
    feeBps: slice.feeBps,
    dueAt: BigInt(looked.dueAt),
    expiresAt: block.timestamp + 86_400n,
    nonce,
    quoteId: looked.exitRef,
  };
  await guardProposal(ctx, vault, proposal);
  return { proposal, slice, vault, exitRef: looked.exitRef };
}

const ZERO_HASH = `0x${"0".repeat(64)}`;

async function guardProposal(ctx: Ctx, vault: string, proposal: AdvanceProposal): Promise<void> {
  assertProposalShape(proposal);
  const payoutTo = await read<Address>(ctx, vault, "payoutTo", [proposal.platform]);
  const expected = same(payoutTo, zeroAddress) ? proposal.platform : payoutTo;
  if (!same(proposal.recipient, expected)) {
    throw new HarnessError("recipient is not the mandate payout", "VALIDATION");
  }
  if (await read<boolean>(ctx, vault, "nonceUsed", [proposal.nonce])) {
    throw new HarnessError("nonce is already used", "REPLAY");
  }
  const filed = await read<Hex>(ctx, vault, "proposalHashOf", [proposal.nonce]);
  if (!same(filed, ZERO_HASH)) throw new HarnessError("nonce already holds a proposal", "REPLAY");
  const reason = Number(await read(ctx, vault, "preview", [proposalTuple(proposal)]));
  if (reason !== 0) throw new HarnessError(`vault preview rejected the proposal (${reason})`, "ASSERTION");
}

async function funded(ctx: Ctx, drafted: { proposal: AdvanceProposal; slice: Slice; vault: string; exitRef: Hex }, hash: Hex) {
  const advanceId = await read<bigint>(ctx, drafted.vault, "advanceCount");
  return {
    hash,
    vault: drafted.vault,
    advanceId: advanceId.toString(),
    fee: drafted.slice.fee.toString(),
    navValue: drafted.slice.navValue.toString(),
    exitRef: drafted.exitRef,
    nonce: drafted.proposal.nonce.toString(),
  };
}

function logicalVault(ctx: Ctx, address: Address): string {
  if (same(address, ctx.binding("PartnerVaultA").address)) return "PartnerVaultA";
  if (same(address, ctx.binding("PartnerVaultB").address)) return "PartnerVaultB";
  throw new HarnessError(`Vault ${address} is not a deployed partner vault`, "ASSERTION");
}

async function exitRequest(ctx: Ctx, input: Record<string, string>) {
  const block = await ctx.publicClient.getBlock();
  const navValue = parseUsdg(input.navUsdg ?? "1000");
  const dueAt = block.timestamp + 3_600n;
  const exitRef = keccak256(toBytes(`lockgate.exit.${input.nonce ?? "1"}.${input.strategy ?? "0"}.${navValue}`));
  const request = {
    platform: ctx.binding(input.platform ?? "WeeklyQueuePlatform").address,
    recipient: ROLES.platform.address,
    navValue,
    feeBps: parseBps(input.feeBps ?? "25"),
    dueAt,
    exitRef,
  };
  return { request, exitRef, dueAt };
}

function asSlices(value: unknown): Slice[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) => {
    const item = row as Slice & readonly unknown[];
    if (item && typeof item === "object" && "vault" in item) {
      return { vault: item.vault, navValue: BigInt(item.navValue), fee: BigInt(item.fee), feeBps: Number(item.feeBps) };
    }
    const tuple = item as readonly unknown[];
    return { vault: tuple[0] as Address, navValue: BigInt(tuple[1] as bigint), fee: BigInt(tuple[2] as bigint), feeBps: Number(tuple[3]) };
  });
}
