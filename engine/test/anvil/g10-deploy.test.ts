import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { monthEpoch } from "../../src/examples.js";
import { DEFAULT_PARAMS } from "../../src/pricing/defaults.js";
import { buildProposal } from "../../src/proposal/build.js";
import { filePartnerProposal } from "../../src/proposal/partner.js";
import { signBuiltProposal } from "../../src/proposal/sign.js";
import { mandateDrift, previewName, previewReason, readVaultFacts } from "../../src/proposal/vaultread.js";
import { artifact, KEYS } from "./chain.js";

const DAY = 86_400;
const U = 1_000_000n;
const NAV = 1_000_000n;
const DEPOSIT = 5_000_000n;
const RESERVE = 1_000_000n;
const LIMIT = 100_000n * U;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const MANIFEST = process.env.LOCKGATE_ANVIL_MANIFEST
  ?? join(dirname(fileURLToPath(import.meta.url)), "../../../harness/deployments/31337.json");

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const manifestSchema = z.object({
  chainId: z.literal(31337),
  rpc: z.string().url(),
  contracts: z.object({
    PartnerVaultA: address,
    MockUSDG: address,
    WeeklyQueuePlatform: address.optional(),
  }),
  roles: z.object({
    lockgate: address,
    partnerA: address,
    platform: address,
  }),
});

type Live = {
  client: PublicClient;
  chain: ReturnType<typeof defineChain>;
  vault: Address;
  platform: Address;
  token: Address;
  lockgate: Address;
  partner: Address;
  recipient: Address;
  lockgateKey: Hex;
  partnerKey: Hex;
};

function anvilKey(account: Address): Hex | undefined {
  return KEYS.find((key) => privateKeyToAccount(key).address.toLowerCase() === account.toLowerCase());
}

function loopback(rpc: string): boolean {
  const url = new URL(rpc);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return (host === "127.0.0.1" || host === "localhost") && url.port !== "" && url.port !== "8545";
}

/** The G10 manifest names the deployment. A dead port, the shared 8545 node, or empty code is a skip. */
async function connect(): Promise<Live | undefined> {
  let parsed: z.infer<typeof manifestSchema>;
  try {
    parsed = manifestSchema.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));
    if (!loopback(parsed.rpc)) return undefined;
  } catch {
    return undefined;
  }
  const chain = defineChain({
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [parsed.rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(parsed.rpc, { timeout: 1_500, retryCount: 0 }) });
  try {
    if (await client.getChainId() !== 31337) return undefined;
    const code = await client.getBytecode({ address: getAddress(parsed.contracts.PartnerVaultA) });
    if (!code || code === "0x") return undefined;
  } catch {
    return undefined;
  }
  const lockgate = getAddress(parsed.roles.lockgate);
  const partner = getAddress(parsed.roles.partnerA);
  const lockgateKey = anvilKey(lockgate);
  const partnerKey = anvilKey(partner);
  if (!lockgateKey || !partnerKey) return undefined;
  return {
    client,
    chain,
    vault: getAddress(parsed.contracts.PartnerVaultA),
    platform: getAddress(parsed.contracts.WeeklyQueuePlatform ?? parsed.roles.platform),
    token: getAddress(parsed.contracts.MockUSDG),
    lockgate,
    partner,
    recipient: getAddress(parsed.roles.platform),
    lockgateKey,
    partnerKey,
  };
}

async function write(
  live: Live,
  key: Hex,
  address: Address,
  abi: ReturnType<typeof artifact>["abi"],
  functionName: string,
  args: readonly unknown[],
): Promise<void> {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: live.chain, transport: http(live.chain.rpcUrls.default.http[0]) });
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName,
    args: args as never,
    account,
    chain: live.chain,
  });
  const receipt = await live.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
}

async function readAt<T>(live: Live, address: Address, abi: ReturnType<typeof artifact>["abi"], functionName: string, args: readonly unknown[] = []): Promise<T> {
  return live.client.readContract({ address, abi, functionName, args: args as never }) as Promise<T>;
}

describe("g10 local deployment", () => {
  it("files an engine proposal on the harness Anvil and pays when the partner approves", async (ctx) => {
    const live = await connect();
    if (!live) {
      ctx.skip();
      return;
    }
    const vaultAbi = artifact("PartnerVault").abi;
    const tokenAbi = artifact("MockUSDG").abi;
    expect(await readAt<Address>(live, live.vault, vaultAbi, "owner")).toBe(live.partner);
    const now = Number((await live.client.getBlock()).timestamp);
    const exposure = await readAt<bigint>(live, live.vault, vaultAbi, "exposureOf", [live.platform]);
    const limit = exposure + LIMIT;
    await write(live, live.partnerKey, live.vault, vaultAbi, "setMandate", [10, BigInt(40 * DAY), 5_000, BigInt(now + 40 * DAY)]);
    await write(live, live.partnerKey, live.vault, vaultAbi, "setPlatform", [live.platform, true, limit, 750, false, BigInt(DAY)]);
    await write(live, live.partnerKey, live.vault, vaultAbi, "setPayout", [live.platform, live.recipient]);
    await write(live, live.partnerKey, live.vault, vaultAbi, "setProposer", [live.lockgate]);
    const reserveTarget = ((exposure + NAV) * 750n + 9_999n) / 10_000n;
    const posted = reserveTarget > RESERVE ? reserveTarget : RESERVE;
    const idle = await readAt<bigint>(live, live.vault, vaultAbi, "idle");
    const reserve = await readAt<bigint>(live, live.vault, vaultAbi, "reserveOf", [live.platform]);
    const needed = (idle < DEPOSIT ? DEPOSIT - idle : 0n) + (reserve < posted ? posted - reserve : 0n);
    if (needed > 0n) {
      const balance = await readAt<bigint>(live, live.token, tokenAbi, "balanceOf", [live.partner]);
      if (balance < needed) await write(live, live.partnerKey, live.token, tokenAbi, "faucet", [needed - balance]);
      await write(live, live.partnerKey, live.token, tokenAbi, "approve", [live.vault, needed]);
      if (idle < DEPOSIT) await write(live, live.partnerKey, live.vault, vaultAbi, "deposit", [DEPOSIT - idle]);
      if (reserve < posted) await write(live, live.partnerKey, live.vault, vaultAbi, "postReserve", [live.platform, posted - reserve]);
    }
    const stamped = Number((await live.client.getBlock()).timestamp);
    let nonce = BigInt(stamped) + 1_000_000n;
    let facts = await readVaultFacts(live.client, live.vault, live.platform, nonce);
    if (facts.nonceUsed || facts.proposalHash !== ZERO_HASH) nonce += 1n;
    facts = await readVaultFacts(live.client, live.vault, live.platform, nonce);
    expect(facts.nonceUsed).toBe(false);
    expect(facts.proposalHash).toBe(ZERO_HASH);
    const built = buildProposal({
      input: {
        ...monthEpoch(stamped),
        navValue: NAV,
        exposure,
        reserveBalance: posted,
        limit,
        bookAssets: limit,
      },
      params: DEFAULT_PARAMS,
      mandate: {
        vault: live.vault,
        partner: facts.partner,
        signer: facts.signer,
        approvedPlatforms: [live.platform],
        platformLimits: { [live.platform]: facts.limit },
        minFeeBps: facts.minFeeBps,
        maxTenorSeconds: facts.maxTenorSeconds,
        concentrationCapBps: facts.concentrationCapBps,
        expiresAt: facts.expiresAt,
        payoutTo: facts.payoutTo === zeroAddress ? live.platform : facts.payoutTo,
        paused: facts.paused,
        idle: facts.idle,
        totalAssets: facts.totalAssets,
      },
      platform: live.platform,
      recipient: live.recipient,
      chainId: 31337,
      nonce,
    });
    expect(built.submittable, built.blocks.map((block) => block.code).join(",")).toBe(true);
    expect(mandateDrift(built.mandate, live.platform, facts)).toEqual([]);
    expect(previewName(await previewReason(live.client, live.vault, built.message))).toBe("none");
    const beforePay = await readAt<bigint>(live, live.token, tokenAbi, "balanceOf", [live.recipient]);
    const beforeIdle = await readAt<bigint>(live, live.vault, vaultAbi, "idle");
    const signature = await signBuiltProposal(built, live.lockgateKey);
    const account = privateKeyToAccount(live.lockgateKey);
    const wallet: WalletClient = createWalletClient({ account, chain: live.chain, transport: http(live.chain.rpcUrls.default.http[0]) });
    await filePartnerProposal(built.partner, true, signature, 31337, live.lockgate, async (tx) => {
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, account, chain: live.chain });
      const receipt = await live.client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("submitProposal reverted");
      return hash;
    });
    expect(await readAt<Hex>(live, live.vault, vaultAbi, "proposalHashOf", [nonce])).toBe(built.digest);
    expect(await readAt<boolean>(live, live.vault, vaultAbi, "nonceUsed", [nonce])).toBe(false);
    expect(await readAt<bigint>(live, live.token, tokenAbi, "balanceOf", [live.recipient])).toBe(beforePay);
    expect(await readAt<bigint>(live, live.vault, vaultAbi, "idle")).toBe(beforeIdle);
    const advances = await readAt<bigint>(live, live.vault, vaultAbi, "advanceCount");
    await write(live, live.partnerKey, live.vault, vaultAbi, "approve", [built.message]);
    expect(await readAt<boolean>(live, live.vault, vaultAbi, "nonceUsed", [nonce])).toBe(true);
    expect(await readAt<Hex>(live, live.vault, vaultAbi, "proposalHashOf", [nonce])).toBe(built.digest);
    expect(await readAt<bigint>(live, live.vault, vaultAbi, "advanceCount")).toBe(advances + 1n);
    expect(await readAt<bigint>(live, live.vault, vaultAbi, "owedOf", [advances + 1n])).toBe(built.message.navValue);
    expect(await readAt<bigint>(live, live.token, tokenAbi, "balanceOf", [live.recipient]) - beforePay).toBe(built.message.payout);
    expect(beforeIdle - await readAt<bigint>(live, live.vault, vaultAbi, "idle")).toBe(built.message.payout);
  }, 60_000);
});
