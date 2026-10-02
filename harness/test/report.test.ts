import assert from "node:assert/strict";
import { test } from "node:test";
import { setMandate } from "../src/actions/stage2.js";
import { loadCtx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { HarnessError } from "../src/errors.js";
import { scanOutput } from "../src/hygiene.js";
import { readManifest, type Manifest } from "../src/manifest.js";
import { formatEventArgs, main, renderReport, runReport, type StateReport } from "../src/report.js";
import { ROLES } from "../src/roles.js";
import { withAnvil } from "./anvil.js";

const HASH = `0x${"ab".repeat(32)}`;
const ONE = "0x1111111111111111111111111111111111111111";

function sheet(contracts: Record<string, string>, rpc = "http://127.0.0.1:8546", chainId = 31337): Manifest {
  return {
    mode: "protocol",
    chainId,
    rpc,
    artifactRoot: "contracts",
    factory: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    contracts,
    roles: { lockgate: ROLES.lockgate.address },
  };
}

function sample(extraContracts = 0, extraEvents = 0): StateReport {
  const contracts = Array.from({ length: 2 + extraContracts }, (_, index) => ({
    name: `Contract${index}`,
    address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    code: true,
  }));
  const events = Array.from({ length: extraEvents }, (_, index) => ({
    block: String(index + 1),
    contract: "PartnerVaultA",
    name: "MandateGlobalsSet",
    args: "minFeeBps 25",
  }));
  return {
    chainId: 31337,
    block: "4",
    mode: "protocol",
    endpoint: "127.0.0.1:18546",
    contracts,
    balances: [
      "lockgate 200000  platform 40000  partnerA 80000  partnerB 50000",
      "senior 100000  junior 20000  investor 20000  governor 0",
      "lockgateEth 9999.9",
    ],
    line: "capital 0  outstanding 0  paused false",
    mandates: [
      { vault: "PartnerVaultA", text: "minFee 25bps  tenor 7d  conc 5000bps  exp 100  signer 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
      { vault: "PartnerVaultB", text: "none" },
    ],
    events,
  };
}

test("the screen stays within 40 lines and drops 32-byte values", () => {
  const args = formatEventArgs({
    0: HASH,
    minFeeBps: 25n,
    digest: HASH,
    signer: ROLES.partnerA.address,
    note: "set",
  });
  assert.equal(args.includes(HASH.slice(2)), false);
  assert.match(args, /minFeeBps 25/);
  assert.match(args, new RegExp(ROLES.partnerA.address));
  const screen = renderReport(sample(0, 1));
  const lines = screen.split("\n");
  assert.ok(lines.length <= 40);
  assert.equal(lines.every((line) => line.length <= 120), true);
  assert.match(screen, /Contracts 2/);
  assert.match(screen, /PartnerVaultB  none/);
  assert.match(screen, /lockgate 200000/);
  assert.equal(scanOutput("report", screen).length, 0);
  const crowded = renderReport(sample(30, 20));
  assert.ok(crowded.split("\n").length <= 40);
  assert.match(crowded, /\+\d+ more/);
  assert.match(crowded, /Events \d+ of 20/);
});

test("a public host, port 8545, chain 42161, and a missing artifact are refused before a read", async () => {
  let reads = 0;
  const report = async () => {
    reads += 1;
    return sample();
  };
  const refused = (code: string) => (err: unknown) => err instanceof HarnessError && err.code === code;
  await assert.rejects(() => runReport({}, { manifest: sheet({ MockUSDG: ONE }, "https://sepolia-rollup.arbitrum.io/rpc"), report }), refused("CHAIN_REFUSED"));
  await assert.rejects(() => runReport({}, { manifest: sheet({ MockUSDG: ONE }, "http://127.0.0.1:8545"), report }), refused("PORT_RESERVED"));
  await assert.rejects(() => runReport({}, { manifest: sheet({ MockUSDG: ONE }), chainId: async () => 42161, report }), refused("MAINNET_REFUSED"));
  let chainReads = 0;
  await assert.rejects(() => runReport({}, {
    manifest: sheet({ NotAContract: ONE }),
    chainId: async () => {
      chainReads += 1;
      return 31337;
    },
    report,
  }), refused("NOT_BUILT"));
  assert.equal(reads, 0);
  assert.equal(chainReads, 0);
  const stderr: string[] = [];
  const code = await main({}, {
    manifest: sheet({ MockUSDG: ONE }, "http://127.0.0.1:8545"),
    stdout: () => undefined,
    stderr: (line) => stderr.push(line),
    report,
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stderr[0] ?? "{}").code, "PORT_RESERVED");
  assert.equal(reads, 0);
});

test("a local deploy prints contracts, balances, the mandate, and MandateGlobalsSet", { timeout: 180_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    await setMandate(ctx, { vault: "PartnerVaultA", minFeeBps: "25" });
    const stdout: string[] = [];
    const code = await main(
      { ...process.env, HARNESS_RPC: rpc, HARNESS_MANIFEST: manifestFile, LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "" },
      {
        stdout: (line) => stdout.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    assert.equal(code, 0);
    const screen = stdout.join("\n");
    const lines = screen.split("\n");
    assert.ok(lines.length <= 40, String(lines.length));
    assert.equal(lines.every((line) => line.length <= 120), true, lines.find((line) => line.length > 120));
    const manifest = readManifest(manifestFile);
    assert.match(screen, new RegExp(`PartnerVaultA +${manifest.contracts.PartnerVaultA}`));
    assert.match(screen, /lockgate 200000/);
    assert.match(screen, /PartnerVaultA  minFee 25bps  tenor 7d  conc 5000bps/);
    assert.match(screen, new RegExp(`signer ${ROLES.partnerA.address}`));
    assert.match(screen, /PartnerVaultB  none/);
    assert.match(screen, /MandateGlobalsSet/);
    assert.match(screen, /chain 31337/);
    assert.equal(scanOutput("report", screen).length, 0);
  });
});
