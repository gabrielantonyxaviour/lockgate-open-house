import { type Address } from "viem";
import { type Ctx, read, send } from "../chain.js";
import { HarnessError } from "../errors.js";
import { writeManifest } from "../manifest.js";
import { DEMO } from "../params.js";
import { ROLES, type RoleName } from "../roles.js";

export const MAX = (1n << 256n) - 1n;
export const SHARE = 10n ** 18n;
export const NAV = DEMO.nav;

export async function approve(ctx: Ctx, role: RoleName, spenderLogical: string, amount = MAX): Promise<void> {
  await send(ctx, role, "MockUSDG", "approve", [ctx.binding(spenderLogical).address, amount]);
}

export async function expectRevert(fn: () => Promise<unknown>, part: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof HarnessError ? err.message : err instanceof Error ? err.message : "";
    if (message.includes(part)) return;
    throw new HarnessError(`expected revert containing ${part}`, "ASSERTION", message);
  }
  throw new HarnessError(`expected revert containing ${part}`, "ASSERTION");
}

export function expect(condition: boolean, message: string, details?: unknown): void {
  if (!condition) throw new HarnessError(message, "ASSERTION", details);
}

export function remember(ctx: Ctx, logical: string, address: Address): void {
  ctx.manifest.contracts[logical] = address;
  if (!ctx.manifestFile) throw new HarnessError("Manifest path is not set", "NOT_DEPLOYED");
  writeManifest(ctx.manifest, ctx.manifestFile);
}

export function navOf(shares: bigint): bigint {
  return (shares * NAV) / SHARE;
}

export function wholeShares(input: string | undefined, fallback: string): bigint {
  const text = input ?? fallback;
  if (!/^\d+$/.test(text) || text === "0") throw new HarnessError("shares must be a positive whole number", "VALIDATION");
  return BigInt(text) * SHARE;
}

export async function balanceOf(ctx: Ctx, account: Address): Promise<bigint> {
  return read<bigint>(ctx, "MockUSDG", "balanceOf", [account]);
}

export const PLATFORM_NAMES = ["", "WeeklyQueuePlatform", "EpochQueuePlatform", "QuarterlyGatedPlatform"] as const;

export function platformLogical(kind: number): string {
  const name = PLATFORM_NAMES[kind];
  if (!name) throw new HarnessError("kind must be 1 weekly, 2 epoch, or 3 quarterly", "VALIDATION");
  return name;
}

export function vaultRole(vault: string): RoleName {
  if (vault === "PartnerVaultA") return "partnerA";
  if (vault === "PartnerVaultB") return "partnerB";
  throw new HarnessError("vault must be PartnerVaultA or PartnerVaultB", "VALIDATION");
}

export function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function roleAddress(role: RoleName): Address {
  return ROLES[role].address;
}
