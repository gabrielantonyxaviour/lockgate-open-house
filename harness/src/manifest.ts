import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/** Replace `path` by rename. A failed write removes the temp file and leaves the previous bytes. */
export function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    if (err instanceof HarnessError) throw err;
    throw new HarnessError("Could not write the manifest", "INTERNAL");
  }
}

export function writeManifest(manifest: Manifest, path = manifestPath(manifest.chainId)): void {
  writeAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
