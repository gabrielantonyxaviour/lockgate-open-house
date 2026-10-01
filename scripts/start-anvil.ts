import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { failureBody } from "../harness/src/errors.js";
import { parseAnvilEnv } from "../harness/src/input.js";

try {
  const { port } = parseAnvilEnv(process.env);
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pidFile = fileURLToPath(new URL("../harness/.anvil.pid", import.meta.url));
  writeFileSync(pidFile, `${child.pid ?? ""}\n`);
  process.stdout.write(`${JSON.stringify({ pid: child.pid, rpc: `http://127.0.0.1:${port}` })}\n`);
} catch (err: unknown) {
  process.stderr.write(`${JSON.stringify(failureBody(err))}\n`);
  process.exit(1);
}
