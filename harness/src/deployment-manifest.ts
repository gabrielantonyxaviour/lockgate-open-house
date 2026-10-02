import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { z } from "zod";
import { loadArtifact, repoRoot } from "./artifacts.js";
import { protocolPlan, type Planned, type ProtocolOwners } from "./deploy.js";
import { HarnessError } from "./errors.js";
import {
  ANVIL_CHAIN_ID,
  ARBITRUM_ONE,
  ARBITRUM_SEPOLIA,
  PAXOS_USDG_SEPOLIA,
  assertLocalRpc,
} from "./guards.js";
import { writeAtomic } from "./manifest.js";
import { MIN_DEPLOYER_WEI, fetchProbe, preflight } from "./preflight.js";
import { ROLES } from "./roles.js";

/** G10 says not to run the Sepolia deploy, and PRODUCT.md records no funded approval. */
export const SEPOLIA_BROADCAST_APPROVED_IN_BRIEFS = false;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export type Json = string | boolean | null | Json[] | { [key: string]: Json };

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.boolean(), z.null(), z.array(jsonSchema), z.record(jsonSchema)]),
);

const stepSchema = z.object({
  logical: z.string().min(1),
  kind: z.enum(["create", "create2", "external"]),
  address,
  salt: hash.nullable(),
  initHash: hash.nullable(),
  constructorArgs: z.array(jsonSchema),
  txHash: hash.nullable(),
  blockNumber: z.number().int().nonnegative().nullable(),
});

export const deploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["executed", "dry-run"]),
  target: z.enum(["local", "sepolia"]),
  chainId: z.union([z.literal(ANVIL_CHAIN_ID), z.literal(ARBITRUM_SEPOLIA)]),
  asset: z.enum(["mock", "paxos"]),
  deployer: address,
  factoryNonce: z.number().int().nonnegative(),
  factory: address,
  roles: z.object({
    deployer: address,
    governor: address,
    partnerA: address,
    partnerB: address,
  }),
  steps: z.array(stepSchema).min(1),
}).superRefine((doc, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (doc.target === "local" && (doc.chainId !== ANVIL_CHAIN_ID || doc.asset === "paxos")) fail("local");
  if (doc.target === "sepolia" && (doc.chainId !== ARBITRUM_SEPOLIA || doc.mode !== "dry-run")) fail("sepolia");
  if (doc.roles.governor.toLowerCase() === doc.roles.deployer.toLowerCase()) fail("governor");
  if (doc.roles.deployer.toLowerCase() !== doc.deployer.toLowerCase()) fail("deployer");
  const names = new Set<string>();
  for (const step of doc.steps) {
    if (names.has(step.logical)) fail("duplicate");
    names.add(step.logical);
    const live = step.txHash !== null || step.blockNumber !== null;
    if (doc.mode === "dry-run" && live) fail("receipt");
    if (doc.mode === "executed" && step.kind !== "external" && (step.txHash === null || step.blockNumber === null)) fail("receipt");
    if (step.kind === "external" && (live || step.salt !== null || step.initHash !== null || step.constructorArgs.length !== 0)) fail("external");
    if (step.kind === "create" && step.salt !== null) fail("salt");
    if (step.kind === "create2" && (step.salt === null || step.initHash === null)) fail("create2");
    if (step.kind !== "external" && step.initHash === null) fail("init");
  }
  const factory = doc.steps[0];
  if (!factory || factory.logical !== "Create2Factory" || factory.address.toLowerCase() !== doc.factory.toLowerCase()) fail("factory");
  const token = doc.steps.find((step) => step.logical === "MockUSDG");
  if (!token) fail("token");
  if (doc.asset === "paxos" && (token?.kind !== "external" || token.address.toLowerCase() !== PAXOS_USDG_SEPOLIA.toLowerCase())) fail("paxos");
  if (doc.asset === "mock" && token?.kind !== "create2") fail("mock");
  for (const name of ["LockgateCreditLine", "PartnerVaultA", "FundFactory", "LockgateExitPool"]) {
    if (!names.has(name)) fail(name);
  }
});

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

const requestSchema = z.object({
  target: z.enum(["local", "sepolia"]),
  deployer: address,
  governor: address,
  partnerA: address,
  partnerB: address,
  factoryNonce: z.number().int().nonnegative().default(0),
  paxos: z.boolean().default(false),
});

export type DeploymentRequest = z.infer<typeof requestSchema>;

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  const parsed = deploymentManifestSchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("Deployment manifest is invalid", "VALIDATION");
  return parsed.data;
}

export function deploymentManifestPath(chainId: number): string {
  return join(repoRoot, "harness", "deployments", `${chainId}.deployment.json`);
}

export function readDeploymentManifest(path: string): DeploymentManifest {
  try {
    return parseDeploymentManifest(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError(`Cannot read deployment manifest ${path}`, "VALIDATION");
  }
}

export function writeDeploymentManifest(doc: DeploymentManifest, path: string): void {
  writeAtomic(path, `${JSON.stringify(parseDeploymentManifest(doc))}\n`);
}

/** Same inputs always return the same addresses and constructor args. No RPC. */
export function buildDeployment(raw: unknown): DeploymentManifest {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HarnessError("Deployment request is invalid", "VALIDATION");
  const input = parsed.data;
  if (input.governor.toLowerCase() === input.deployer.toLowerCase()) {
    throw new HarnessError("Set GOVERNOR_ADDRESS to an account other than the deployer", "VALIDATION");
  }
  if (input.target === "local" && input.paxos) {
    throw new HarnessError("Local Anvil deploys MockUSDG. Paxos USDG is a Sepolia address", "VALIDATION");
  }
  const owners: ProtocolOwners = {
    owner: input.deployer as Address,
    governor: input.governor as Address,
    partnerA: input.partnerA as Address,
    partnerB: input.partnerB as Address,
  };
  const factory = getContractAddress({ from: owners.owner, nonce: BigInt(input.factoryNonce) });
  const external = input.paxos ? PAXOS_USDG_SEPOLIA as Address : undefined;
  const planned = protocolPlan(factory, owners, external);
  const factoryCode = loadArtifact("Create2Factory").bytecode;
  const steps = [
    blank("Create2Factory", "create", factory, null, keccak256(factoryCode), []),
    ...(external ? [blank("MockUSDG", "external", external, null, null, [])] : []),
    ...planned.map(plannedStep),
  ];
  return parseDeploymentManifest({
    schemaVersion: 1,
    mode: "dry-run",
    target: input.target,
    chainId: input.target === "local" ? ANVIL_CHAIN_ID : ARBITRUM_SEPOLIA,
    asset: input.paxos ? "paxos" : "mock",
    deployer: input.deployer,
    factoryNonce: input.factoryNonce,
    factory,
    roles: {
      deployer: input.deployer,
      governor: input.governor,
      partnerA: input.partnerA,
      partnerB: input.partnerB,
    },
    steps,
  });
}

/**
 * Refuses a Sepolia send. The default approval bit is the brief, not an env flag.
 * Tests pass `approved` to prove the balance floor without sending a transaction.
 */
export function assertSepoliaMayBroadcast(balanceWei: bigint, approved = SEPOLIA_BROADCAST_APPROVED_IN_BRIEFS): void {
  if (balanceWei < 0n) throw new HarnessError("Deployer balance is invalid", "VALIDATION");
  if (!approved) {
    throw new HarnessError(
      "Sepolia broadcast stays a dry run. briefs/grok/G10-harness-deploy.md does not approve a funded deploy",
      "SEPOLIA_BLOCKED",
    );
  }
  if (balanceWei < MIN_DEPLOYER_WEI) {
    throw new HarnessError("Deployer balance is below the 0.001 ETH floor", "UNFUNDED");
  }
}

/** Deploys the plan on loopback chain 31337 and records each receipt. */
export async function executeLocalDeployment(rpc: string, file: string): Promise<DeploymentManifest> {
  assertLocalRpc(rpc);
  await preflight({ target: "local", deployer: ROLES.lockgate.address, probe: fetchProbe(rpc) });
  const account = privateKeyToAccount(ROLES.lockgate.key);
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain: foundry, transport });
  const wallet = createWalletClient({ account, chain: foundry, transport });
  const chainId = await publicClient.getChainId();
  if (chainId === ARBITRUM_ONE) throw new HarnessError("Arbitrum One is refused", "MAINNET_REFUSED");
  if (chainId !== ANVIL_CHAIN_ID) throw new HarnessError("Local deploy requires chain 31337", "CHAIN_REFUSED");
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  if (nonce !== 0) throw new HarnessError("Lockgate nonce must be 0 on a fresh Anvil", "NOT_FRESH");
  const dry = buildDeployment({
    target: "local",
    deployer: account.address,
    governor: ROLES.governor.address,
    partnerA: ROLES.partnerA.address,
    partnerB: ROLES.partnerB.address,
    factoryNonce: 0,
    paxos: false,
  });
  const artifact = loadArtifact("Create2Factory");
  const planned = protocolPlan(dry.factory as Address);
  for (const item of planned) {
    const step = dry.steps.find((candidate) => candidate.logical === item.logical);
    if (!step || JSON.stringify(item.args.map(toJson)) !== JSON.stringify(step.constructorArgs)) {
      throw new HarnessError(`${item.logical} constructor args do not match the plan`, "DEPLOY_MISMATCH");
    }
  }
  const inits = new Map(planned.map((item) => [item.logical, item.init]));
  const steps = [];
  for (const step of dry.steps) {
    if (step.kind === "external") {
      steps.push(step);
      continue;
    }
    const init = step.kind === "create2" ? inits.get(step.logical) : undefined;
    if (step.kind === "create2" && (!step.salt || !init)) {
      throw new HarnessError(`${step.logical} is not in the local plan`, "DEPLOY_MISMATCH");
    }
    const txHash = step.kind === "create"
      ? await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, account, chain: foundry })
      : await wallet.writeContract({
        address: dry.factory as Address,
        abi: artifact.abi,
        functionName: "deploy",
        args: [step.salt as Hex, init as Hex],
        account,
        chain: foundry,
      });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new HarnessError(`${step.logical} deploy failed`, "DEPLOY_FAILED");
    const code = await publicClient.getBytecode({ address: step.address as Address });
    if (!code || code === "0x") throw new HarnessError(`${step.logical} missing at ${step.address}`, "DEPLOY_MISMATCH");
    steps.push({ ...step, txHash, blockNumber: blockNumber(receipt.blockNumber) });
  }
  const executed = parseDeploymentManifest({ ...dry, mode: "executed", steps });
  writeDeploymentManifest(executed, file);
  return executed;
}

function plannedStep(item: Planned) {
  return blank(item.logical, "create2", item.address, item.salt, keccak256(item.init), item.args.map(toJson));
}

function blank(
  logical: string,
  kind: "create" | "create2" | "external",
  deployed: Address,
  salt: Hex | null,
  initHash: Hex | null,
  constructorArgs: Json[],
) {
  return { logical, kind, address: deployed, salt, initHash, constructorArgs, txHash: null, blockNumber: null };
}

function blockNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new HarnessError("Block number is too large", "VALIDATION");
  return Number(value);
}

function toJson(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new HarnessError("Constructor arg is not an integer", "VALIDATION");
    return String(value);
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new HarnessError("Constructor arg is empty", "VALIDATION");
      out[key] = toJson(item);
    }
    return out;
  }
  throw new HarnessError("Constructor arg is not serializable", "VALIDATION");
}
