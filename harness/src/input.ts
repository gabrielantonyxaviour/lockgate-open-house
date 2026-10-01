import { z } from "zod";
import { HarnessError } from "./errors.js";
import { ARBITRUM_SEPOLIA, assertAnvilPort, assertLocalRpc } from "./guards.js";
import { manifestPath } from "./manifest.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const actBodySchema = z.object({
  action: z.string().min(1).max(64),
  input: z.record(z.string().max(256)).optional(),
});

export const flagSchema = z.record(z.string().min(1).max(64), z.string().max(256));

const localEnvSchema = z.object({
  HARNESS_RPC: z.string().min(1).max(512),
  HARNESS_MANIFEST: z.string().min(1).max(512).optional(),
});

const sepoliaEnvSchema = z.object({
  DEPLOYER_PRIVATE_KEY: hexKey,
  SEPOLIA_RPC: z.string().url().max(512).optional(),
  PARTNER_A_ADDRESS: address.optional(),
  PARTNER_B_ADDRESS: address.optional(),
  GOVERNOR_ADDRESS: address.optional(),
  USE_PAXOS_USDG: z.enum(["0", "1"]).optional(),
});

const serverEnvSchema = z.object({
  HARNESS_PORT: z.string().regex(/^[0-9]+$/),
  HARNESS_RPC: z.string().min(1).max(512).optional(),
  HARNESS_MANIFEST: z.string().min(1).max(512).optional(),
});

const anvilEnvSchema = z.object({
  HARNESS_ANVIL_PORT: z.string().regex(/^[0-9]+$/),
});

const manifestFileSchema = z.string().min(1).max(512);

export type SepoliaEnv = {
  key: `0x${string}`;
  rpc?: string;
  partnerA?: `0x${string}`;
  partnerB?: `0x${string}`;
  governor?: `0x${string}`;
  paxos: boolean;
};

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseActBody(value: unknown): { action: string; input: Record<string, string> } {
  const parsed = actBodySchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("action body is invalid", "VALIDATION");
  return { action: parsed.data.action, input: parsed.data.input ?? {} };
}

export function parseFlags(value: Record<string, string>): Record<string, string> {
  const parsed = flagSchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("flags are invalid", "VALIDATION");
  return parsed.data;
}

/** CLI env. An unset RPC leaves the manifest URL alone. A set RPC must be loopback. */
export function parseCliEnv(env: NodeJS.ProcessEnv): { rpc?: string; manifestFile?: string } {
  const parsed = z.object({
    HARNESS_RPC: z.string().min(1).max(512).optional(),
    HARNESS_MANIFEST: z.string().min(1).max(512).optional(),
  }).safeParse({
    HARNESS_RPC: present(env.HARNESS_RPC),
    HARNESS_MANIFEST: present(env.HARNESS_MANIFEST),
  });
  if (!parsed.success) throw new HarnessError("CLI environment is invalid", "VALIDATION");
  if (parsed.data.HARNESS_RPC) assertLocalRpc(parsed.data.HARNESS_RPC);
  return { rpc: parsed.data.HARNESS_RPC, manifestFile: parsed.data.HARNESS_MANIFEST };
}

/** Local deploy env. Checked before any RPC call. The default RPC is loopback port 8546. */
export function parseLocalDeployEnv(env: NodeJS.ProcessEnv): { rpc: string; manifestFile?: string } {
  const parsed = localEnvSchema.safeParse({
    HARNESS_RPC: env.HARNESS_RPC === undefined ? "http://127.0.0.1:8546" : env.HARNESS_RPC,
    HARNESS_MANIFEST: present(env.HARNESS_MANIFEST),
  });
  if (!parsed.success) throw new HarnessError("Local deploy environment is invalid", "VALIDATION");
  assertLocalRpc(parsed.data.HARNESS_RPC);
  return { rpc: parsed.data.HARNESS_RPC, manifestFile: parsed.data.HARNESS_MANIFEST };
}

/**
 * Sepolia env. The allow flag and the key are checked before any RPC call.
 * A zod failure uses a fixed sentence so the key is not copied into the message.
 */
export function parseSepoliaEnv(env: NodeJS.ProcessEnv): SepoliaEnv {
  if (env.LOCKGATE_ALLOW_SEPOLIA_DEPLOY !== "1") {
    throw new HarnessError(
      "Sepolia broadcast is blocked until LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1",
      "SEPOLIA_BLOCKED",
    );
  }
  const parsed = sepoliaEnvSchema.safeParse({
    DEPLOYER_PRIVATE_KEY: env.DEPLOYER_PRIVATE_KEY,
    SEPOLIA_RPC: present(env.SEPOLIA_RPC),
    PARTNER_A_ADDRESS: present(env.PARTNER_A_ADDRESS),
    PARTNER_B_ADDRESS: present(env.PARTNER_B_ADDRESS),
    GOVERNOR_ADDRESS: present(env.GOVERNOR_ADDRESS),
    USE_PAXOS_USDG: present(env.USE_PAXOS_USDG),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "DEPLOYER_PRIVATE_KEY") {
      throw new HarnessError("DEPLOYER_PRIVATE_KEY must be a 32-byte hex string from the environment", "MISSING_ENV");
    }
    throw new HarnessError("Sepolia environment is invalid", "VALIDATION");
  }
  const data = parsed.data;
  return {
    key: data.DEPLOYER_PRIVATE_KEY as `0x${string}`,
    rpc: data.SEPOLIA_RPC,
    partnerA: data.PARTNER_A_ADDRESS as `0x${string}` | undefined,
    partnerB: data.PARTNER_B_ADDRESS as `0x${string}` | undefined,
    governor: data.GOVERNOR_ADDRESS as `0x${string}` | undefined,
    paxos: data.USE_PAXOS_USDG === "1",
  };
}

/** Console env. A set RPC must already be a loopback URL. */
export function parseServerEnv(env: NodeJS.ProcessEnv): { port: number; rpc?: string; manifestFile?: string } {
  const parsed = serverEnvSchema.safeParse({
    HARNESS_PORT: env.HARNESS_PORT ?? "18910",
    HARNESS_RPC: present(env.HARNESS_RPC),
    HARNESS_MANIFEST: present(env.HARNESS_MANIFEST),
  });
  if (!parsed.success) throw new HarnessError("Server environment is invalid", "VALIDATION");
  const port = Number(parsed.data.HARNESS_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HarnessError("HARNESS_PORT is out of range", "VALIDATION");
  }
  if (parsed.data.HARNESS_RPC) assertLocalRpc(parsed.data.HARNESS_RPC);
  return { port, rpc: parsed.data.HARNESS_RPC, manifestFile: parsed.data.HARNESS_MANIFEST };
}

/** Anvil port. Checked before spawn. 8545 stays reserved for the shared node. */
export function parseAnvilEnv(env: NodeJS.ProcessEnv): { port: number } {
  const parsed = anvilEnvSchema.safeParse({
    HARNESS_ANVIL_PORT: env.HARNESS_ANVIL_PORT ?? "8546",
  });
  if (!parsed.success) throw new HarnessError("Anvil environment is invalid", "VALIDATION");
  return { port: assertAnvilPort(parsed.data.HARNESS_ANVIL_PORT) };
}

/** Optional Sepolia manifest path. An unset value uses deployments/421614.json. */
export function parseSepoliaManifest(env: NodeJS.ProcessEnv): string {
  const raw = present(env.SEPOLIA_MANIFEST);
  if (raw === undefined) return manifestPath(ARBITRUM_SEPOLIA);
  const parsed = manifestFileSchema.safeParse(raw);
  if (!parsed.success) throw new HarnessError("Sepolia environment is invalid", "VALIDATION");
  return parsed.data;
}
