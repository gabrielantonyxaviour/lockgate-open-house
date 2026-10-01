import { HarnessError } from "../harness/src/errors.js";
import { broadcastSepolia } from "../harness/src/sepolia.js";
import { manifestPath } from "../harness/src/manifest.js";
import { ARBITRUM_SEPOLIA } from "../harness/src/guards.js";

const file = process.env.SEPOLIA_MANIFEST ?? manifestPath(ARBITRUM_SEPOLIA);

broadcastSepolia(process.env, file).then((manifest) => {
  process.stdout.write(`${JSON.stringify({
    mode: manifest.mode,
    chainId: manifest.chainId,
    factory: manifest.factory,
    usdg: manifest.contracts.MockUSDG,
    paxos: process.env.USE_PAXOS_USDG === "1",
  })}\n`);
}).catch((err: unknown) => {
  const body = err instanceof HarnessError ? err.toJSON() : { error: err instanceof Error ? err.message : "failed", code: "INTERNAL" };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exitCode = 1;
});
