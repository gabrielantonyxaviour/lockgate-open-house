import { existsSync } from "node:fs";
import { findAction } from "./actions/catalog.js";
import { loadCtx } from "./chain.js";
import { HarnessError } from "./errors.js";
import { parseFlags } from "./input.js";
import { manifestPath, readManifest } from "./manifest.js";

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) throw new HarnessError(`Unexpected argument ${token}`, "VALIDATION");
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new HarnessError(`Missing value for --${key}`, "VALIDATION");
    out[key] = value;
    i += 1;
  }
  return parseFlags(out);
}

async function main(): Promise<void> {
  const [id, ...rest] = process.argv.slice(2);
  if (!id || id === "help") {
    const { ACTIONS } = await import("./actions/catalog.js");
    process.stdout.write(`${ACTIONS.map((action) => action.id).join("\n")}\n`);
    return;
  }
  const action = findAction(id);
  if (!action) throw new HarnessError(`Unknown action ${id}`, "VALIDATION");
  const path = process.env.HARNESS_MANIFEST ?? manifestPath(31337);
  if (!existsSync(path)) throw new HarnessError(`No manifest at ${path}. Run npm run deploy:local`, "NOT_DEPLOYED");
  const manifest = readManifest(path);
  if (process.env.HARNESS_RPC) manifest.rpc = process.env.HARNESS_RPC;
  const ctx = await loadCtx(manifest, path);
  const result = await action.run(ctx, flags(rest));
  process.stdout.write(`${JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
}

main().catch((err: unknown) => {
  const body = err instanceof HarnessError ? err.toJSON() : { error: err instanceof Error ? err.message : "failed", code: "INTERNAL" };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exitCode = 1;
});
