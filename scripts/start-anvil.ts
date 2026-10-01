import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HarnessError } from "../harness/src/errors.js";
import { assertAnvilPort } from "../harness/src/guards.js";

let port: number;
try {
  port = assertAnvilPort(process.env.HARNESS_ANVIL_PORT ?? "8546");
} catch (err) {
  const body = err instanceof HarnessError ? err.toJSON() : { error: "bad port", code: "VALIDATION" };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exit(1);
}

const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], {
  detached: true,
  stdio: "ignore",
});
child.unref();
const pidFile = fileURLToPath(new URL("../harness/.anvil.pid", import.meta.url));
writeFileSync(pidFile, `${child.pid ?? ""}\n`);
process.stdout.write(`${JSON.stringify({ pid: child.pid, rpc: `http://127.0.0.1:${port}` })}\n`);
