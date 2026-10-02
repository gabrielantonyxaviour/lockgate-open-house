import {
  assertSepoliaMayBroadcast,
  buildDeployment,
  deploymentManifestPath,
  executeLocalDeployment,
} from "../harness/src/deployment-manifest.js";
import { failureBody, HarnessError } from "../harness/src/errors.js";
import { ANVIL_CHAIN_ID } from "../harness/src/guards.js";

void main(process.argv.slice(2), process.env, {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
}).then((code) => {
  process.exitCode = code;
});

async function main(argv: readonly string[], env: NodeJS.ProcessEnv, io: {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}): Promise<number> {
  try {
    const command = argv[0] ?? "sepolia";
    if (command === "broadcast") {
      assertSepoliaMayBroadcast(0n);
      throw new HarnessError("Sepolia broadcast stays a dry run", "SEPOLIA_BLOCKED");
    }
    if (command === "sepolia") {
      const nonce = env.FACTORY_NONCE ?? "0";
      if (!/^[0-9]+$/.test(nonce)) throw new HarnessError("FACTORY_NONCE must be an integer", "VALIDATION");
      io.stdout(JSON.stringify(buildDeployment({
        target: "sepolia",
        deployer: env.DEPLOYER_ADDRESS,
        governor: env.GOVERNOR_ADDRESS,
        partnerA: env.PARTNER_A_ADDRESS,
        partnerB: env.PARTNER_B_ADDRESS,
        factoryNonce: Number(nonce),
        paxos: env.USE_PAXOS_USDG === "1",
      })));
      return 0;
    }
    if (command === "local") {
      const rpc = env.HARNESS_RPC ?? "http://127.0.0.1:8546";
      const file = env.HARNESS_DEPLOYMENT ?? deploymentManifestPath(ANVIL_CHAIN_ID);
      const doc = await executeLocalDeployment(rpc, file);
      io.stdout(JSON.stringify({ mode: doc.mode, chainId: doc.chainId, factory: doc.factory, steps: doc.steps.length }));
      return 0;
    }
    throw new HarnessError("Usage: deployment-manifest.ts [sepolia|local|broadcast]", "VALIDATION");
  } catch (err: unknown) {
    io.stderr(JSON.stringify(failureBody(err)));
    return 1;
  }
}
