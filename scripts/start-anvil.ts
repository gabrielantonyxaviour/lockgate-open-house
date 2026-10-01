import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const port = process.env.HARNESS_ANVIL_PORT ?? "8546";
if (port === "8545") {
  process.stderr.write("{\"error\":\"port 8545 belongs to the shared Anvil\",\"code\":\"PORT_RESERVED\"}\n");
  process.exit(1);
}

const child = spawn("anvil", ["--host", "127.0.0.1", "--port", port, "--chain-id", "31337", "--silent"], {
  detached: true,
  stdio: "ignore",
});
child.unref();
const pidFile = fileURLToPath(new URL("../harness/.anvil.pid", import.meta.url));
writeFileSync(pidFile, `${child.pid ?? ""}\n`);
process.stdout.write(`${JSON.stringify({ pid: child.pid, rpc: `http://127.0.0.1:${port}` })}\n`);
