import { deployProtocol } from "../harness/src/deploy.js";
import { HarnessError } from "../harness/src/errors.js";

const rpc = process.env.HARNESS_RPC ?? "http://127.0.0.1:8546";

deployProtocol(rpc, process.env.HARNESS_MANIFEST).then((manifest) => {
  process.stdout.write(`${JSON.stringify({ mode: manifest.mode, chainId: manifest.chainId, factory: manifest.factory, contracts: manifest.contracts })}\n`);
}).catch((err: unknown) => {
  const body = err instanceof HarnessError ? err.toJSON() : { error: err instanceof Error ? err.message : "failed", code: "INTERNAL" };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exitCode = 1;
});
