import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { fixtureRoot, protocolRoot, repoRoot } from "./artifacts.js";
import { failureBody, HarnessError } from "./errors.js";
import { writeAtomic } from "./manifest.js";

const MAX_FILE = 2_000_000;
const ARTIFACT = /^([^/]+)\.sol\/\1\.json$/;

export type ArtifactRootName = "contracts" | "fixture";
export type ChecksumRoots = Record<ArtifactRootName, string>;
export type ChecksumReport = { ok: true; files: number; algorithm: "sha256"; wrote?: true };

export type ChecksumIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  roots?: ChecksumRoots;
  manifestFile?: string;
};

type Row = { root: ArtifactRootName; path: string; sha256: string };

const rowSchema = z.object({
  root: z.enum(["contracts", "fixture"]),
  path: z.string().regex(/^[^/]+\.sol\/[^/]+\.json$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).superRefine((row, ctx) => {
  const name = row.path.slice(0, row.path.indexOf(".sol/"));
  if (row.path !== `${name}.sol/${name}.json`) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name" });
});

const manifestSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("sha256"),
  files: z.array(rowSchema).min(1).max(5_000),
});

export function defaultRoots(): ChecksumRoots {
  return { contracts: join(protocolRoot, "out"), fixture: join(fixtureRoot, "out") };
}

export function defaultChecksumPath(): string {
  return join(repoRoot, "harness", "checksums", "artifacts.json");
}

/** Hash every generated `Contract.sol/Contract.json` and replace the seal. */
export function writeChecksum(roots: ChecksumRoots, file: string): ChecksumReport {
  const abs = assertSeal(file, roots);
  const files = collect(roots);
  writeAtomic(abs, body(files));
  return { ok: true, wrote: true, files: files.length, algorithm: "sha256" };
}

/** Recompute the generated artifacts. An edit, add, or delete is `STALE`. */
export function verifyChecksum(roots: ChecksumRoots, file: string): ChecksumReport {
  const abs = assertSeal(file, roots);
  const recorded = readSeal(abs);
  const live = collect(roots);
  const problems = compare(recorded, live);
  if (problems.length > 0) stale(problems);
  return { ok: true, files: live.length, algorithm: "sha256" };
}

export function main(argv: readonly string[], env: NodeJS.ProcessEnv, io: ChecksumIo): number {
  try {
    const command = argv[0] ?? "write";
    if (argv.length > 1 || (command !== "write" && command !== "verify")) {
      throw new HarnessError("Checksum command must be write or verify", "VALIDATION");
    }
    const roots = io.roots ?? defaultRoots();
    const file = io.manifestFile ?? pathFromEnv(env);
    const report = command === "verify" ? verifyChecksum(roots, file) : writeChecksum(roots, file);
    io.stdout(JSON.stringify(report));
    return 0;
  } catch (err: unknown) {
    io.stderr(JSON.stringify(failureBody(err)));
    return 1;
  }
}

function pathFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = env.HARNESS_CHECKSUM;
  if (raw === undefined) return defaultChecksumPath();
  return raw;
}

function body(files: readonly Row[]): string {
  return `${JSON.stringify({ version: 1, algorithm: "sha256", files }, null, 2)}\n`;
}

function collect(roots: ChecksumRoots): Row[] {
  const files = (["contracts", "fixture"] as const).flatMap((label) => listRoot(label, roots[label]));
  files.sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path));
  if (files.length === 0) throw new HarnessError("No generated artifacts to checksum", "NOT_BUILT");
  return files;
}

function listRoot(label: ArtifactRootName, dir: string): Row[] {
  const root = openOut(label, dir);
  const rows: Row[] = [];
  walk(root, root, label, rows);
  return rows;
}

function openOut(label: ArtifactRootName, dir: string): string {
  let info;
  try {
    info = lstatSync(dir);
  } catch {
    throw new HarnessError(`Missing artifact directory for ${label}. Build contracts and harness/fixture first.`, "NOT_BUILT");
  }
  if (info.isSymbolicLink()) throw new HarnessError(`Checksum refuses a symlinked ${label} directory`, "VALIDATION");
  if (!info.isDirectory()) throw new HarnessError(`Checksum ${label} path is not a directory`, "VALIDATION");
  return realpathSync(dir);
}

function walk(root: string, dir: string, label: ArtifactRootName, rows: Row[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new HarnessError(`Checksum refuses a symlink in ${label}`, "VALIDATION");
    if (info.isDirectory()) {
      walk(root, path, label, rows);
      continue;
    }
    if (!info.isFile()) continue;
    const rel = relative(root, path).split(sep).join("/");
    if (!ARTIFACT.test(rel)) continue;
    if (info.size > MAX_FILE) throw new HarnessError(`Artifact ${label}/${rel} is too large`, "VALIDATION");
    rows.push({ root: label, path: rel, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
  }
}

function compare(recorded: readonly Row[], live: readonly Row[]): string[] {
  const have = new Map(live.map((row) => [id(row), row.sha256]));
  const problems: string[] = [];
  for (const row of recorded) {
    const found = have.get(id(row));
    if (found === undefined) problems.push(`missing ${id(row)}`);
    else if (found !== row.sha256) problems.push(`mismatch ${id(row)}`);
    have.delete(id(row));
  }
  for (const extra of [...have.keys()].sort()) problems.push(`extra ${extra}`);
  return problems;
}

function stale(problems: string[]): never {
  const shown = problems.slice(0, 4);
  const extra = problems.length - shown.length;
  const tail = extra > 0 ? ` and ${extra} more` : "";
  throw new HarnessError(`Stale artifacts: ${shown.join(", ")}${tail}`, "STALE");
}

function id(row: { root: string; path: string }): string {
  return `${row.root}/${row.path}`;
}

function readSeal(file: string): Row[] {
  let info;
  try {
    info = lstatSync(file);
  } catch {
    throw new HarnessError("Checksum manifest is missing", "NOT_FOUND");
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new HarnessError("Checksum manifest is not a file", "VALIDATION");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new HarnessError("Checksum manifest is invalid", "VALIDATION");
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw new HarnessError("Checksum manifest is invalid", "VALIDATION");
  const seen = new Set<string>();
  for (const row of result.data.files) {
    const name = id(row);
    if (seen.has(name)) throw new HarnessError("Checksum manifest repeats an artifact", "VALIDATION");
    seen.add(name);
  }
  return result.data.files;
}

function assertSeal(file: string, roots: ChecksumRoots): string {
  if (file.length === 0 || file.length > 512 || file.includes("\0")) {
    throw new HarnessError("Checksum path is invalid", "VALIDATION");
  }
  const abs = resolve(file);
  refuseSymlinkChain(abs);
  const placed = canonicalFile(abs);
  for (const label of ["contracts", "fixture"] as const) {
    const out = existingReal(roots[label]);
    if (out && (placed === out || placed.startsWith(`${out}${sep}`))) {
      throw new HarnessError("Checksum manifest must sit outside the artifact directories", "VALIDATION");
    }
  }
  return abs;
}

/** Real path of the parent, so a macOS `/var` prefix still matches `realpath`. */
function canonicalFile(file: string): string {
  const parent = dirname(file);
  try {
    const info = lstatSync(parent);
    if (!info.isSymbolicLink() && info.isDirectory()) return join(realpathSync(parent), basename(file));
  } catch {
    // The parent is created later. The lexical path is enough for that check.
  }
  return file;
}

function existingReal(dir: string): string | undefined {
  try {
    const info = lstatSync(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return resolve(dir);
    return realpathSync(dir);
  } catch {
    return undefined;
  }
}

/**
 * Refuse a symlink at the seal file, or at a parent inside this repo.
 * An OS directory such as macOS `/tmp` is a symlink and is not one of ours.
 */
function refuseSymlinkChain(file: string): void {
  const root = resolve(repoRoot);
  let rootReal = root;
  try {
    rootReal = realpathSync(root);
  } catch {
    rootReal = root;
  }
  let cur = file;
  while (true) {
    try {
      if (lstatSync(cur).isSymbolicLink() && (cur === file || inRepo(cur, root, rootReal))) {
        throw new HarnessError("Checksum refuses a symlink", "VALIDATION");
      }
      return;
    } catch (err) {
      if (err instanceof HarnessError) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw new HarnessError("Checksum path is unreadable", "VALIDATION");
    }
    const parent = dirname(cur);
    if (parent === cur) return;
    cur = parent;
  }
}

function inRepo(path: string, root: string, rootReal: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`) || path === rootReal || path.startsWith(`${rootReal}${sep}`);
}
