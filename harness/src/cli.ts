import { existsSync } from "node:fs";
import { findAction, usageText } from "./actions/catalog.js";
import { loadCtx } from "./chain.js";
import { failureBody, HarnessError } from "./errors.js";
import { parseCliEnv, parseFlags } from "./input.js";
import { manifestPath, readManifest } from "./manifest.js";

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) throw new HarnessError("Unexpected argument", "VALIDATION");
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new HarnessError("Missing value for a flag", "VALIDATION");
    out[key] = value;
    i += 1;
  }
  return parseFlags(out);
}

async function main(): Promise<void> {
  const [id, ...rest] = process.argv.slice(2);
  if (!id || id === "help") {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  const action = findAction(id);
  if (!action) throw new HarnessError("Unknown action", "VALIDATION");
  const env = parseCliEnv(process.env);
  const path = env.manifestFile ?? manifestPath(31337);
  if (!existsSync(path)) throw new HarnessError(`No manifest at ${path}. Run npm run deploy:local`, "NOT_DEPLOYED");
  const manifest = readManifest(path);
  if (env.rpc) manifest.rpc = env.rpc;
  const ctx = await loadCtx(manifest, path);
  const result = await action.run(ctx, flags(rest));
  process.stdout.write(`${JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify(failureBody(err))}\n`);
  process.exitCode = 1;
});
