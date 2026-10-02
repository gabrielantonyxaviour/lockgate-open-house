import { failureBody } from "../harness/src/errors.js";
import { parseSepoliaManifest } from "../harness/src/input.js";
import { broadcastSepolia } from "../harness/src/sepolia.js";

void (async () => {
  try {
    const file = parseSepoliaManifest(process.env);
    const manifest = await broadcastSepolia(process.env, file);
    process.stdout.write(`${JSON.stringify({
      mode: manifest.mode,
      chainId: manifest.chainId,
      factory: manifest.factory,
      usdg: manifest.contracts.MockUSDG,
      paxos: process.env.USE_PAXOS_USDG === "1",
    })}\n`);
  } catch (err: unknown) {
    process.stderr.write(`${JSON.stringify(failureBody(err))}\n`);
    process.exitCode = 1;
  }
})();
