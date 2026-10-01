import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findAction, surface } from "./actions/catalog.js";
import { loadCtx, type Ctx } from "./chain.js";
import { HarnessError } from "./errors.js";
import { parseActBody } from "./input.js";
import { manifestPath, readManifest } from "./manifest.js";
import { inOrder } from "./turnstile.js";

const webRoot = fileURLToPath(new URL("../web", import.meta.url));
const MAX_BODY = 8_192;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    throw new HarnessError("body is too large", "VALIDATION");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new HarnessError("body is too large", "VALIDATION");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HarnessError("body is not JSON", "VALIDATION");
  }
}

export function startServer(ctx: Ctx, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(join(webRoot, "index.html")));
        return;
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(readFileSync(join(webRoot, "app.js")));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/surface") {
        sendJson(res, 200, { mode: ctx.manifest.mode, actions: surface() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const action = findAction("read.status");
        sendJson(res, 200, await action?.run(ctx, {}));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/act") {
        await inOrder(async () => {
          const body = parseActBody(await readBody(req));
          const action = findAction(body.action);
          if (!action) throw new HarnessError(`Unknown action ${body.action}`, "UNKNOWN_ACTION");
          sendJson(res, 200, { ok: true, result: await action.run(ctx, body.input) });
        });
        return;
      }
      sendJson(res, 404, { error: "not found", code: "NOT_FOUND" });
    } catch (err) {
      const body = err instanceof HarnessError ? err.toJSON() : { error: err instanceof Error ? err.message : "failed", code: "INTERNAL" };
      const status = body.code === "VALIDATION" ? 400 : 422;
      sendJson(res, status, body);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${bound}`,
        close: () => new Promise((done, reject) => server.close((err) => err ? reject(err) : done())),
      });
    });
  });
}

async function main(): Promise<void> {
  const path = process.env.HARNESS_MANIFEST ?? manifestPath(31337);
  const manifest = readManifest(path);
  if (process.env.HARNESS_RPC) manifest.rpc = process.env.HARNESS_RPC;
  const ctx = await loadCtx(manifest, path);
  const port = Number(process.env.HARNESS_PORT ?? 18910);
  const started = await startServer(ctx, port);
  process.stderr.write(`harness ${started.url}\n`);
}

if (process.argv[1]?.endsWith("server.ts")) {
  main().catch((err: unknown) => {
    const body = err instanceof HarnessError ? err.toJSON() : { error: err instanceof Error ? err.message : "failed", code: "INTERNAL" };
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 1;
  });
}
