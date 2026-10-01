import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  publicActions,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadArtifact, type Artifact } from "./artifacts.js";
import { HarnessError } from "./errors.js";
import { ANVIL_CHAIN_ID, assertHarnessWrite } from "./guards.js";
import { type Manifest } from "./manifest.js";
import { ROLES, type RoleName } from "./roles.js";

export type Ctx = {
  manifest: Manifest;
  manifestFile: string;
  chainId: number;
  publicClient: PublicClient;
  testClient: ReturnType<typeof makeTestClient>;
  wallet: (role: RoleName) => WalletClient;
  binding: (logical: string) => { abi: Artifact["abi"]; address: Address };
};

function makeTestClient(rpc: string) {
  return createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) }).extend(publicActions);
}

export async function loadCtx(manifest: Manifest, manifestFile = ""): Promise<Ctx> {
  const transport = http(manifest.rpc);
  const publicClient = createPublicClient({ chain: foundry, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== manifest.chainId) {
    throw new HarnessError(`RPC chain ${chainId} does not match manifest ${manifest.chainId}`, "CHAIN_REFUSED");
  }
  const testClient = makeTestClient(manifest.rpc);
  const wallets = new Map<RoleName, WalletClient>();
  return {
    manifest,
    manifestFile,
    chainId,
    publicClient,
    testClient,
    wallet(role) {
      const cached = wallets.get(role);
      if (cached) return cached;
      const account = privateKeyToAccount(ROLES[role].key);
      const client = createWalletClient({ account, chain: foundry, transport });
      wallets.set(role, client);
      return client;
    },
    binding(logical) {
      const address = manifest.contracts[logical];
      if (!address) throw new HarnessError(`Contract ${logical} is not in the manifest`, "NOT_DEPLOYED");
      const artifact = loadArtifact(logical);
      return { abi: artifact.abi, address: address as Address };
    },
  };
}

export async function deployNew(ctx: Ctx, role: RoleName, logical: string, args: readonly unknown[]): Promise<Address> {
  assertHarnessWrite(ctx.chainId);
  const artifact = loadArtifact(logical);
  const wallet = ctx.wallet(role);
  if (!wallet.account) throw new HarnessError(`Role ${role} has no account`, "ROLE_UNKNOWN");
  try {
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args,
      account: wallet.account,
      chain: foundry,
    } as never);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) {
      throw new HarnessError(`${logical} deploy returned no address`, "DEPLOY_FAILED");
    }
    return receipt.contractAddress;
  } catch (err) {
    throw explain(err);
  }
}

export async function send(ctx: Ctx, role: RoleName, logical: string, functionName: string, args: readonly unknown[]): Promise<Hex> {
  assertHarnessWrite(ctx.chainId);
  const { abi, address } = ctx.binding(logical);
  const wallet = ctx.wallet(role);
  if (!wallet.account) throw new HarnessError(`Role ${role} has no account`, "ROLE_UNKNOWN");
  try {
    const hash = await wallet.writeContract({
      address,
      abi,
      functionName,
      args,
      account: wallet.account,
      chain: foundry,
    } as never);
    await ctx.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    throw explain(err);
  }
}

export async function read<T>(ctx: Ctx, logical: string, functionName: string, args: readonly unknown[] = []): Promise<T> {
  const { abi, address } = ctx.binding(logical);
  try {
    return await ctx.publicClient.readContract({ address, abi, functionName, args } as never) as T;
  } catch (err) {
    throw explain(err);
  }
}

export async function warpTo(ctx: Ctx, timestamp: bigint): Promise<void> {
  if (ctx.chainId !== ANVIL_CHAIN_ID) {
    throw new HarnessError("Time travel is refused outside local Anvil", "TIME_TRAVEL_REFUSED");
  }
  const block = await ctx.publicClient.getBlock();
  if (timestamp <= block.timestamp) return;
  const seconds = timestamp - block.timestamp;
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HarnessError("Warp is too far", "VALIDATION");
  }
  await ctx.testClient.increaseTime({ seconds: Number(seconds) });
  await ctx.testClient.mine({ blocks: 1 });
}

export function explain(err: unknown): HarnessError {
  if (err instanceof HarnessError) return err;
  const anyErr = err as { shortMessage?: string; message?: string; walk?: (fn: (e: unknown) => boolean) => unknown };
  const names: string[] = [];
  const shorts: string[] = [];
  anyErr.walk?.((inner) => {
    const item = inner as { shortMessage?: string; data?: { errorName?: string; args?: readonly unknown[] } };
    if (item?.data?.errorName) {
      const args = item.data.args?.map(String).join(",") ?? "";
      names.push(args ? `${item.data.errorName}(${args})` : item.data.errorName);
    }
    if (item?.shortMessage) shorts.push(item.shortMessage);
    return false;
  });
  const message = names[0] ?? shorts[0] ?? (err instanceof Error ? (anyErr.shortMessage ?? err.message) : "rpc failure");
  const reverted = names.length > 0 || shorts.length > 0;
  return new HarnessError(message, reverted ? "REVERT" : "RPC", { names, shorts });
}
