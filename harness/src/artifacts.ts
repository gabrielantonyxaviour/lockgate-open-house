import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Abi, type Hex } from "viem";
import { z } from "zod";
import { HarnessError } from "./errors.js";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const fixtureRoot = fileURLToPath(new URL("../fixture", import.meta.url));
export const protocolRoot = join(repoRoot, "contracts");

/** Logical name → Solidity contract file. Platforms share no bytecode; vault proxies use PartnerVault. */
const CONTRACT_FILE: Record<string, string> = {
  WeeklyQueuePlatform: "WeeklyCyclePlatform",
  EpochQueuePlatform: "EpochQueuePlatform",
  QuarterlyGatedPlatform: "QuarterlyWindowPlatform",
  WeeklyImpl: "WeeklyCyclePlatform",
  EpochImpl: "EpochQueuePlatform",
  QuarterImpl: "QuarterlyWindowPlatform",
  PartnerVaultA: "PartnerVault",
  PartnerVaultB: "PartnerVault",
  PartnerVaultImpl: "PartnerVault",
  Router: "PartnerRouter",
  HarnessBook: "HarnessBook",
  Create2Factory: "Create2Factory",
  ERC1967Proxy: "ERC1967Proxy",
};

const FIXTURE_FILES = new Set(["HarnessBook", "Create2Factory", "ERC1967Proxy", "ImportProxy", "PegOracle"]);

export type Artifact = { abi: Abi; bytecode: Hex };

export type ImmutableSpan = { start: number; length: number };

export type DeployedBytecode = { bytecode: Hex; immutables: ImmutableSpan[] };

const cache = new Map<string, Artifact>();
const deployedCache = new Map<string, DeployedBytecode>();

const spanSchema = z.object({
  start: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});

const deployedSchema = z.object({
  object: z.string().regex(/^0x[0-9a-fA-F]*$/),
  immutableReferences: z.record(z.array(spanSchema)).optional(),
});

export function contractFile(logical: string): string {
  return CONTRACT_FILE[logical] ?? logical;
}

export function artifactRootFor(logical: string): string {
  return FIXTURE_FILES.has(contractFile(logical)) ? fixtureRoot : protocolRoot;
}

export function loadArtifact(logical: string): Artifact {
  const file = contractFile(logical);
  const root = artifactRootFor(logical);
  const key = `${root}:${file}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const path = join(root, "out", `${file}.sol`, `${file}.json`);
  let json: { abi?: Abi; bytecode?: { object?: string } };
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as { abi?: Abi; bytecode?: { object?: string } };
  } catch {
    throw new HarnessError(
      `Missing artifact ${file} under ${root}. Build contracts and harness/fixture first.`,
      "NOT_BUILT",
    );
  }
  const bytecode = json.bytecode?.object;
  if (!json.abi || !bytecode || bytecode === "0x") {
    throw new HarnessError(`Artifact ${file} has no bytecode`, "NOT_BUILT");
  }
  const artifact = { abi: json.abi, bytecode: bytecode as Hex };
  cache.set(key, artifact);
  return artifact;
}

/** Runtime code from the current build. Immutable slots are listed so a diff can ignore constructor arguments. */
export function loadDeployedBytecode(logical: string): DeployedBytecode {
  const file = contractFile(logical);
  const root = artifactRootFor(logical);
  const key = `${root}:${file}`;
  const hit = deployedCache.get(key);
  if (hit) return hit;
  const path = join(root, "out", `${file}.sol`, `${file}.json`);
  let json: { deployedBytecode?: unknown };
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as { deployedBytecode?: unknown };
  } catch {
    throw new HarnessError(
      `Missing artifact ${file} under ${root}. Build contracts and harness/fixture first.`,
      "NOT_BUILT",
    );
  }
  const parsed = deployedSchema.safeParse(json.deployedBytecode);
  const bytecode = parsed.success ? parsed.data.object : "";
  if (!parsed.success || bytecode === "0x" || (bytecode.length - 2) % 2 !== 0) {
    throw new HarnessError(`Artifact ${file} has no deployed bytecode`, "NOT_BUILT");
  }
  const immutables = Object.values(parsed.data.immutableReferences ?? {}).flat();
  const deployed = { bytecode: bytecode as Hex, immutables };
  deployedCache.set(key, deployed);
  return deployed;
}
