import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const children = new Set<ChildProcess>();

export async function freePort(): Promise<number> {
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(chosen));
    });
  });
  if (port === 8545 || port === 0) return freePort();
  return port;
}

export async function withAnvil<T>(run: (rpc: string, manifestFile: string) => Promise<T>, chainId = 31337): Promise<T> {
  const port = await freePort();
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"], {
    stdio: "ignore",
  });
  children.add(child);
  const rpc = `http://127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), "lockgate-harness-"));
  try {
    await waitForRpc(rpc);
    return await run(rpc, join(dir, "manifest.json"));
  } finally {
    child.kill("SIGTERM");
    await exited(child);
    children.delete(child);
    await rm(dir, { recursive: true, force: true });
  }
}

/** Start one Anvil. Pass a port to bind again after `stop`. Never uses 8545. */
export async function openAnvil(fixedPort?: number, chainId = 31337): Promise<{ rpc: string; port: number; stop: () => Promise<void> }> {
  const port = fixedPort ?? await freePort();
  if (port === 8545 || port < 1024 || port > 65535) throw new Error("refusing this Anvil port");
  for (let attempt = 0; attempt < 20; attempt++) {
    const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"], {
      stdio: "ignore",
    });
    children.add(child);
    const rpc = `http://127.0.0.1:${port}`;
    if (await answers(rpc, child)) {
      return {
        rpc,
        port,
        stop: async () => {
          child.kill("SIGTERM");
          await exited(child);
          children.delete(child);
        },
      };
    }
    child.kill("SIGTERM");
    await exited(child);
    children.delete(child);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Anvil did not answer on ${port}`);
}

async function answers(rpc: string, child: ChildProcess): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return true;
    } catch {
      // The port is still closing, or Anvil has not bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function waitForRpc(rpc: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Anvil did not answer at ${rpc}`);
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}
