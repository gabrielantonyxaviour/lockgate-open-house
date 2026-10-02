import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROLES } from "./roles.js";

/** Foundry's published Anvil keys. They may sit in source. Command output may not repeat them. */
const ANVIL = new Set(Object.values(ROLES).map((role) => role.key.toLowerCase()));

const HEX64 = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const SECRET_LINE = /private[\s_-]*key|secret[\s_-]*key|mnemonic|\bkey\b/i;
const RPC_TOKEN = /https?:\/\/[^\s"'`<>]*?(?:\/v[23]\/(?!public(?:[/"'\s]|$))[A-Za-z0-9_-]{8,}|[?&](?:api[_-]?key|apikey|token)=[A-Za-z0-9_-]{8,})/i;
const SAFE_FIELD = /"(?:salt|initHash|txHash|blockHash|hash|digest|quoteId|exitRef|submitted)"\s*:\s*"0x[0-9a-fA-F]{64}"/gi;

const SKIP_DIR = new Set([
  "node_modules", "lib", "out", "cache", "broadcast", "deployments", ".git", "dist", "coverage", "reports",
]);
const TEXT = new Set(["ts", "tsx", "js", "mjs", "cjs", "json", "md", "yml", "yaml", "sol", "html", "toml", "txt", "env"]);

export type Finding = { path: string; line: number; kind: "private-key" | "rpc-token" };

/**
 * Stdout, stderr, and files the harness writes. Salt, init hash, tx hash,
 * block hash, digest, quote id, exit ref, and the submitProposal hash stay.
 * Every other 32-byte hex value is a private key. The matched text is not returned.
 */
export function scanOutput(path: string, text: string): Finding[] {
  const hits: Finding[] = [];
  text.split("\n").forEach((line, index) => {
    if (RPC_TOKEN.test(line)) hits.push({ path, line: index + 1, kind: "rpc-token" });
    if (HEX64.test(line.replace(SAFE_FIELD, ""))) hits.push({ path, line: index + 1, kind: "private-key" });
    HEX64.lastIndex = 0;
  });
  return hits;
}

/** First-party source. Published Anvil keys are allowed. Any other key assignment or RPC token is a hit. */
export function scanSource(path: string, text: string): Finding[] {
  const env = path.endsWith(".env") || path.includes(`${sep}.env`);
  const hits: Finding[] = [];
  text.split("\n").forEach((line, index) => {
    if (RPC_TOKEN.test(line)) hits.push({ path, line: index + 1, kind: "rpc-token" });
    const keyed = env || SECRET_LINE.test(line);
    if (!keyed) return;
    for (const match of line.matchAll(HEX64)) {
      if (!ANVIL.has(match[0].toLowerCase())) hits.push({ path, line: index + 1, kind: "private-key" });
    }
  });
  return hits;
}

/** Every regular file under `root`. Symlinks are not followed. Missing paths are empty. */
export function scanFiles(root: string): Finding[] {
  const hits: Finding[] = [];
  collect(root, hits);
  return hits;
}

function collect(path: string, hits: Finding[]): void {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return;
  }
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    let names: string[];
    try {
      names = readdirSync(path);
    } catch {
      return;
    }
    for (const name of names) collect(join(path, name), hits);
    return;
  }
  if (!info.isFile() || info.size > 1_000_000) return;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  hits.push(...scanOutput(path, text));
}

export function scanTree(root: string): Finding[] {
  const hits: Finding[] = [];
  walk(root, root, hits);
  return hits;
}

function walk(root: string, dir: string, hits: Finding[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue;
    const path = join(dir, name);
    let info: ReturnType<typeof statSync>;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      walk(root, path, hits);
      continue;
    }
    if (!textFile(name) || info.size > 1_000_000) continue;
    if (gitIgnored(dir, name)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    hits.push(...scanSource(relative(root, path), text));
  }
}

function textFile(name: string): boolean {
  if (name === ".env" || name.startsWith(".env.")) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && TEXT.has(name.slice(dot + 1));
}

// A local env file that git ignores can never be committed, so it may hold a real key.
function gitIgnored(dir: string, name: string): boolean {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return spawnSync("git", ["check-ignore", "-q", name], { cwd: dir }).status === 0;
}
