import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "../src/artifacts.js";
import { defaultChecksumPath, defaultRoots, main, verifyChecksum, writeChecksum, type ChecksumRoots } from "../src/checksum.js";
import { HarnessError } from "../src/errors.js";

const BODY = "{\"abi\":[]}\n";
const DIGEST = "ebe36bfb88cb0e698d2480b29f3feb9ec4ffb28c8ba4aeb858d623e11941c11d";

function tree(): { dir: string; roots: ChecksumRoots; seal: string } {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-checksum-"));
  const roots: ChecksumRoots = { contracts: join(dir, "contracts-out"), fixture: join(dir, "fixture-out") };
  mkdirSync(roots.contracts);
  mkdirSync(roots.fixture);
  return { dir, roots, seal: join(dir, "artifacts.json") };
}

function artifact(root: string, name: string, body: string): string {
  const dir = join(root, `${name}.sol`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  writeFileSync(path, body);
  return path;
}

function capture(): { stdout: string[]; stderr: string[]; io: { stdout: (line: string) => void; stderr: (line: string) => void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
}

test("a seal records the sha256 of each generated artifact and ignores other files", () => {
  const made = tree();
  try {
    artifact(made.roots.fixture, "Create2Factory", BODY);
    artifact(made.roots.contracts, "MockUSDG", BODY);
    writeFileSync(join(made.roots.contracts, "notes.json"), "ignore");
    mkdirSync(join(made.roots.contracts, "MockUSDG.sol"), { recursive: true });
    writeFileSync(join(made.roots.contracts, "MockUSDG.sol", "other.json"), "ignore");
    const wrote = writeChecksum(made.roots, made.seal);
    assert.deepEqual(wrote, { ok: true, wrote: true, files: 2, algorithm: "sha256" });
    const first = readFileSync(made.seal, "utf8");
    writeChecksum(made.roots, made.seal);
    assert.equal(readFileSync(made.seal, "utf8"), first);
    const doc = JSON.parse(first) as { files: Array<{ root: string; path: string; sha256: string }> };
    assert.deepEqual(doc.files.map((row) => `${row.root}/${row.path}`), [
      "contracts/MockUSDG.sol/MockUSDG.json",
      "fixture/Create2Factory.sol/Create2Factory.json",
    ]);
    assert.equal(doc.files[0]?.sha256, DIGEST);
    assert.equal(DIGEST, createHash("sha256").update(BODY).digest("hex"));
    assert.equal(first.includes("notes.json"), false);
    assert.deepEqual(verifyChecksum(made.roots, made.seal), { ok: true, files: 2, algorithm: "sha256" });
  } finally {
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("an edited, deleted, or added artifact is stale and the digest stays out of the error", () => {
  const made = tree();
  try {
    const path = artifact(made.roots.contracts, "MockUSDG", BODY);
    artifact(made.roots.fixture, "Create2Factory", "{\"abi\":[1]}\n");
    writeChecksum(made.roots, made.seal);
    writeFileSync(path, "{\"abi\":[9]}\n");
    assert.throws(() => verifyChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "STALE");
      assert.equal(err.message, "Stale artifacts: mismatch contracts/MockUSDG.sol/MockUSDG.json");
      assert.equal(/[0-9a-f]{64}/.test(err.message), false);
      return true;
    });
    writeFileSync(path, BODY);
    rmSync(join(made.roots.fixture, "Create2Factory.sol"), { recursive: true });
    assert.throws(() => verifyChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "STALE");
      assert.match(err.message, /missing fixture\/Create2Factory\.sol\/Create2Factory\.json/);
      return true;
    });
    artifact(made.roots.fixture, "Create2Factory", "{\"abi\":[1]}\n");
    artifact(made.roots.contracts, "Extra", BODY);
    assert.throws(() => verifyChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "STALE");
      assert.match(err.message, /extra contracts\/Extra\.sol\/Extra\.json/);
      return true;
    });
  } finally {
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("a missing build, an empty out, and a missing seal fail before a match", () => {
  const made = tree();
  try {
    rmSync(made.roots.contracts, { recursive: true });
    assert.throws(() => writeChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "NOT_BUILT");
      return true;
    });
    mkdirSync(made.roots.contracts);
    assert.throws(() => writeChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "NOT_BUILT");
      assert.equal(err.message, "No generated artifacts to checksum");
      return true;
    });
    artifact(made.roots.contracts, "MockUSDG", BODY);
    assert.throws(() => verifyChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  } finally {
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("a symlink is refused and the target bytes stay unread", () => {
  const made = tree();
  const outside = mkdtempSync(join(tmpdir(), "lockgate-checksum-out-"));
  try {
    const marker = join(outside, "marker.json");
    writeFileSync(marker, "OUTSIDE-MARKER");
    const linked = join(made.dir, "linked-out");
    symlinkSync(made.roots.contracts, linked);
    assert.throws(() => writeChecksum({ ...made.roots, contracts: linked }, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "VALIDATION");
      assert.equal(err.message.includes("OUTSIDE-MARKER"), false);
      return true;
    });
    artifact(made.roots.fixture, "Create2Factory", BODY);
    symlinkSync(marker, join(made.roots.contracts, "MockUSDG.sol"));
    assert.throws(() => writeChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "VALIDATION");
      assert.equal(err.message.includes("OUTSIDE-MARKER"), false);
      return true;
    });
    const keeper = join(outside, "keeper");
    writeFileSync(keeper, "KEEP");
    const via = join(made.dir, "via-link");
    symlinkSync(keeper, via);
    assert.throws(() => writeChecksum({ contracts: made.roots.fixture, fixture: made.roots.fixture }, via), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
    assert.equal(readFileSync(keeper, "utf8"), "KEEP");
  } finally {
    rmSync(made.dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a seal inside out, a bad manifest, and an unknown command are validation", () => {
  const made = tree();
  try {
    artifact(made.roots.contracts, "MockUSDG", BODY);
    artifact(made.roots.fixture, "Create2Factory", BODY);
    assert.throws(() => writeChecksum(made.roots, join(made.roots.contracts, "seal.json")), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
    writeChecksum(made.roots, made.seal);
    const doc = JSON.parse(readFileSync(made.seal, "utf8")) as { files: Array<{ path: string }> };
    doc.files[0]!.path = "MockUSDG.sol/Other.json";
    writeFileSync(made.seal, JSON.stringify(doc));
    assert.throws(() => verifyChecksum(made.roots, made.seal), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
    const caught = capture();
    assert.equal(main(["nope"], {}, { ...caught.io, roots: made.roots, manifestFile: made.seal }), 1);
    assert.deepEqual(JSON.parse(caught.stderr[0] ?? ""), { error: "Checksum command must be write or verify", code: "VALIDATION" });
    assert.equal(Object.keys(JSON.parse(caught.stderr[0] ?? "")).join(), "error,code");
  } finally {
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("main writes and verifies without printing a digest", () => {
  const made = tree();
  try {
    artifact(made.roots.contracts, "MockUSDG", BODY);
    artifact(made.roots.fixture, "Create2Factory", BODY);
    const wrote = capture();
    assert.equal(main(["write"], { HARNESS_CHECKSUM: made.seal }, { ...wrote.io, roots: made.roots }), 0);
    assert.equal(wrote.stderr.length, 0);
    assert.equal(/[0-9a-f]{64}/.test(wrote.stdout.join("\n")), false);
    const checked = capture();
    assert.equal(main(["verify"], {}, { ...checked.io, roots: made.roots, manifestFile: made.seal }), 0);
    assert.deepEqual(JSON.parse(checked.stdout[0] ?? ""), { ok: true, files: 2, algorithm: "sha256" });
    writeFileSync(join(made.roots.contracts, "MockUSDG.sol", "MockUSDG.json"), "{\"abi\":[2]}\n");
    const failed = capture();
    assert.equal(main(["verify"], {}, { ...failed.io, roots: made.roots, manifestFile: made.seal }), 1);
    const body = JSON.parse(failed.stderr[0] ?? "") as { error: string; code: string };
    assert.equal(body.code, "STALE");
    assert.equal(Object.keys(body).join(), "error,code");
    assert.equal(/[0-9a-f]{64}/.test(body.error), false);
  } finally {
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("a symlink parent inside the repo is refused", () => {
  const made = tree();
  const outside = mkdtempSync(join(tmpdir(), "lockgate-checksum-repo-"));
  const link = join(repoRoot, "harness", `checksum-link-${process.pid}`);
  symlinkSync(outside, link);
  try {
    artifact(made.roots.contracts, "MockUSDG", BODY);
    artifact(made.roots.fixture, "Create2Factory", BODY);
    assert.throws(() => writeChecksum(made.roots, join(link, "artifacts.json")), (err: unknown) => {
      assert.ok(err instanceof HarnessError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
    assert.equal(existsSync(join(outside, "artifacts.json")), false);
  } finally {
    rmSync(link, { force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("a seal whose parent is the OS tmp symlink still writes", () => {
  const made = tree();
  const seal = join("/tmp", `lockgate-seal-${process.pid}.json`);
  try {
    artifact(made.roots.contracts, "MockUSDG", BODY);
    artifact(made.roots.fixture, "Create2Factory", BODY);
    assert.equal(writeChecksum(made.roots, seal).files, 2);
    assert.equal(verifyChecksum(made.roots, seal).ok, true);
  } finally {
    rmSync(seal, { force: true });
    rmSync(made.dir, { recursive: true, force: true });
  }
});

test("the default seal path is outside out, and the current build verifies", () => {
  const seal = defaultChecksumPath();
  assert.match(seal, /harness\/checksums\/artifacts\.json$/);
  const roots = defaultRoots();
  assert.equal(seal.startsWith(roots.contracts), false);
  assert.equal(seal.startsWith(roots.fixture), false);
  const made = mkdtempSync(join(tmpdir(), "lockgate-checksum-live-"));
  const file = join(made, "artifacts.json");
  try {
    const wrote = writeChecksum(roots, file);
    assert.equal(wrote.ok, true);
    assert.ok(wrote.files >= 2);
    const doc = JSON.parse(readFileSync(file, "utf8")) as { files: Array<{ root: string; path: string }> };
    assert.equal(doc.files.some((row) => row.root === "contracts" && row.path === "MockUSDG.sol/MockUSDG.json"), true);
    assert.deepEqual(verifyChecksum(roots, file), { ok: true, files: wrote.files, algorithm: "sha256" });
    assert.equal(readFileSync(file, "utf8").includes("0x"), false);
  } finally {
    rmSync(made, { recursive: true, force: true });
  }
});
