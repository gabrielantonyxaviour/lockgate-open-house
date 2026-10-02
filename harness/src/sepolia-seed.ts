import { decodeEventLog, type Address, type PublicClient } from "viem";
import { z } from "zod";
import { loadArtifact } from "./artifacts.js";
import { HarnessError } from "./errors.js";
import { parseUsdg } from "./units.js";

/**
 * Stage-1 seed for a Sepolia deploy, funded only by transfers from the deployer's own USDG balance. Nothing is
 * minted, so it works on Paxos USDG (`USE_PAXOS_USDG=1`) as well as MockUSDG. Off unless `SEED_STAGE1=1`.
 *
 * Default amounts (USDG, 6 dp): capital 10,000 + platform reserve 375 (750 bps of the 5,000 limit) + platform cash
 * 500 + investor 1,000 = 11,875. The deployer must hold at least that before the deploy starts.
 */
export type SeedPlan = {
  capital: bigint;
  limit: bigint;
  reserveBps: number;
  reserve: bigint;
  cash: bigint;
  investorAmount: bigint;
  investor?: Address;
  issuer?: Address;
};

const amount = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const seedEnvSchema = z.object({
  SEED_STAGE1: z.enum(["0", "1"]).optional(),
  SEED_CAPITAL_USDG: amount.default("10000"),
  SEED_LIMIT_USDG: amount.default("5000"),
  SEED_RESERVE_BPS: z.coerce.number().int().min(500).max(1_000).default(750),
  SEED_CASH_USDG: amount.default("500"),
  SEED_INVESTOR_USDG: amount.default("1000"),
  SEED_INVESTOR_ADDRESS: address.optional(),
  PLATFORM_ADDRESS: address.optional(),
});

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Undefined when seeding is off. The reserve is ceil(limit × bps), enough for the whole limit. */
export function parseSeedEnv(env: NodeJS.ProcessEnv): SeedPlan | undefined {
  const keys = Object.keys(seedEnvSchema.shape) as Array<keyof typeof seedEnvSchema.shape>;
  const raw = Object.fromEntries(keys.map((key) => [key, present(env[key])]));
  const parsed = seedEnvSchema.safeParse(raw);
  if (!parsed.success) throw new HarnessError("Stage-1 seed environment is invalid", "VALIDATION");
  const data = parsed.data;
  if (data.SEED_STAGE1 !== "1") return undefined;
  const limit = parseUsdg(data.SEED_LIMIT_USDG);
  const capital = parseUsdg(data.SEED_CAPITAL_USDG);
  if (limit === 0n || capital === 0n) throw new HarnessError("Seed capital and limit must be above zero", "VALIDATION");
  return {
    capital,
    limit,
    reserveBps: data.SEED_RESERVE_BPS,
    reserve: (limit * BigInt(data.SEED_RESERVE_BPS) + 9_999n) / 10_000n,
    cash: parseUsdg(data.SEED_CASH_USDG),
    investorAmount: parseUsdg(data.SEED_INVESTOR_USDG),
    investor: data.SEED_INVESTOR_ADDRESS as Address | undefined,
    issuer: data.PLATFORM_ADDRESS as Address | undefined,
  };
}

/** USDG the deployer spends. The investor transfer is skipped when the investor is the deployer. */
export function seedTotal(plan: SeedPlan, deployer: Address): bigint {
  const investor = plan.investor && plan.investor.toLowerCase() !== deployer.toLowerCase() ? plan.investorAmount : 0n;
  return plan.capital + plan.reserve + plan.cash + investor;
}

export async function assertSeedBalance(
  publicClient: PublicClient, token: Address, deployer: Address, plan: SeedPlan,
): Promise<void> {
  const need = seedTotal(plan, deployer);
  const have = await publicClient.readContract({
    address: token, abi: loadArtifact("MockUSDG").abi, functionName: "balanceOf", args: [deployer],
  }) as bigint;
  if (have < need) {
    throw new HarnessError(`Deployer holds ${have} USDG units; the stage-1 seed needs ${need}`, "INSUFFICIENT_USDG");
  }
}

export type Send = (address: Address, name: string, functionName: string, args: readonly unknown[]) => Promise<`0x${string}`>;

/**
 * Lockgate deposits capital, creates the weekly platform through the owner-only factory with Lockgate's limit and
 * reserve rate, posts the reserve, and funds the platform's cash. Every leg is an approve plus a pull, or a transfer.
 */
export async function seedStage1(
  publicClient: PublicClient, send: Send, contracts: Record<string, Address>, deployer: Address, plan: SeedPlan,
): Promise<Address> {
  const token = contracts.MockUSDG;
  const line = contracts.LockgateCreditLine;
  const reserve = contracts.PlatformReserve;
  const factory = contracts.FundFactory;
  if (!token || !line || !reserve || !factory) throw new HarnessError("Seed needs the core contracts", "DEPLOY_FAILED");
  await send(token, "MockUSDG", "approve", [line, plan.capital]);
  await send(line, "LockgateCreditLine", "depositCapital", [plan.capital]);
  const issuer = plan.issuer ?? deployer;
  const hash = await send(factory, "FundFactory", "createPlatform", [
    1, "Northwind weekly", 600n, 1_000_000n, issuer, plan.limit, plan.reserveBps,
  ]);
  const fund = await createdFund(publicClient, hash);
  await send(token, "MockUSDG", "approve", [reserve, plan.reserve]);
  await send(reserve, "PlatformReserve", "post", [fund, plan.reserve]);
  if (plan.cash > 0n) {
    await send(token, "MockUSDG", "approve", [fund, plan.cash]);
    await send(fund, "WeeklyCyclePlatform", "depositCash", [plan.cash]);
  }
  if (plan.investor && plan.investorAmount > 0n && plan.investor.toLowerCase() !== deployer.toLowerCase()) {
    await send(token, "MockUSDG", "transfer", [plan.investor, plan.investorAmount]);
  }
  return fund;
}

async function createdFund(publicClient: PublicClient, hash: `0x${string}`): Promise<Address> {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const abi = loadArtifact("FundFactory").abi;
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (event.eventName === "PlatformCreated") return (event.args as unknown as { fund: Address }).fund;
    } catch {
      continue;
    }
  }
  throw new HarnessError("Factory did not report the new platform", "DEPLOY_FAILED");
}
