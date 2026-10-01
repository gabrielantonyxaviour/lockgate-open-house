import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { repoRoot } from "./artifacts.js";
import { HarnessError } from "./errors.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const manifestSchema = z.object({
  mode: z.enum(["fixture", "protocol"]),
  chainId: z.number().int(),
  rpc: z.string().url(),
  artifactRoot: z.string().min(1),
  factory: address,
  contracts: z.record(address),
  roles: z.record(address),
});

export type Manifest = z.infer<typeof manifestSchema>;

export function manifestPath(chainId: number): string {
  return join(repoRoot, "harness", "deployments", `${chainId}.json`);
}

export function readManifest(path: string): Manifest {
  try {
    const parsed = manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return parsed;
  } catch (err) {
    throw new HarnessError(`Cannot read deployment manifest ${path}`, "NOT_DEPLOYED", err instanceof Error ? err.message : err);
  }
}

export function writeManifest(manifest: Manifest, path = manifestPath(manifest.chainId)): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
