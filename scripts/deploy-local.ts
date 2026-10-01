import { deployProtocol } from "../harness/src/deploy.js";
import { failureBody } from "../harness/src/errors.js";
import { parseLocalDeployEnv } from "../harness/src/input.js";

try {
  const env = parseLocalDeployEnv(process.env);
  const manifest = await deployProtocol(env.rpc, env.manifestFile);
  process.stdout.write(`${JSON.stringify({ mode: manifest.mode, chainId: manifest.chainId, factory: manifest.factory, contracts: manifest.contracts })}\n`);
} catch (err: unknown) {
  process.stderr.write(`${JSON.stringify(failureBody(err))}\n`);
  process.exitCode = 1;
}
