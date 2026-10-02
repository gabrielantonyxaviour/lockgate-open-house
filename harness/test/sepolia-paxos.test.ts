import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadArtifact, loadDeployedBytecode } from "../src/artifacts.js";
import { HarnessError } from "../src/errors.js";
import { PAXOS_USDG_SEPOLIA } from "../src/guards.js";
import { ROLES } from "../src/roles.js";
import { broadcastSepolia } from "../src/sepolia.js";
import { withAnvil } from "./anvil.js";

const PAXOS = PAXOS_USDG_SEPOLIA as Address;
const U = 1_000_000n;
const ENV = {
  LOCKGATE_ALLOW_SEPOLIA_DEPLOY: "1",
  DEPLOYER_PRIVATE_KEY: ROLES.lockgate.key,
  PARTNER_A_ADDRESS: ROLES.partnerA.address,
  PARTNER_B_ADDRESS: ROLES.partnerB.address,
  USE_PAXOS_USDG: "1",
  SEED_STAGE1: "1",
};

/**
 * Stands in for Paxos USDG: token code at the real address with no owner and no minter, so the only USDG in play is
 * what the deployer took from the capped faucet. Any mint in the deploy path would revert.
 */
async function fakePaxos(rpc: string, whole: bigint): Promise<void> {
  const client = createPublicClient({ chain: foundry, transport: http(rpc) });
  await client.request({
    method: "anvil_setCode" as never,
    params: [PAXOS, loadDeployedBytecode("MockUSDG").bytecode] as never,
  });
  const account = privateKeyToAccount(ROLES.lockgate.key);
  const wallet = createWalletClient({ account, chain: { ...foundry, id: 421614 }, transport: http(rpc) });
  const abi = loadArtifact("MockUSDG").abi;
  for (let left = whole * U; left > 0n; left -= 10_000n * U) {
    const amount = left > 10_000n * U ? 10_000n * U : left;
    const hash = await wallet.writeContract({ address: PAXOS, abi, functionName: "faucet", args: [amount] });
    await client.waitForTransactionReceipt({ hash });
  }
}

test("paxos deploy seeds stage 1 from the deployer balance without minting", { timeout: 180_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await fakePaxos(rpc, 11_875n);
    const manifest = await broadcastSepolia({
      ...ENV, SEPOLIA_RPC: rpc, SEED_INVESTOR_ADDRESS: ROLES.investor.address,
    }, manifestFile);
    const client = createPublicClient({ chain: foundry, transport: http(rpc) });
    const read = (address: string, name: string, functionName: string, args: unknown[] = []) =>
      client.readContract({ address: address as Address, abi: loadArtifact(name).abi, functionName, args }) as Promise<bigint>;
    assert.equal(manifest.contracts.MockUSDG?.toLowerCase(), PAXOS.toLowerCase());
    const line = manifest.contracts.LockgateCreditLine!;
    const fund = manifest.contracts.WeeklyQueuePlatform!;
    assert.equal(await read(line, "LockgateCreditLine", "capital"), 10_000n * U);
    assert.equal(await read(line, "LockgateCreditLine", "limitOf", [fund]), 5_000n * U);
    assert.equal(await read(line, "LockgateCreditLine", "reserveOf", [fund]), 375n * U);
    assert.equal(await read(PAXOS, "MockUSDG", "balanceOf", [fund]), 500n * U);
    assert.equal(await read(PAXOS, "MockUSDG", "balanceOf", [manifest.roles.deployer!]), 0n);
    assert.equal(await read(PAXOS, "MockUSDG", "balanceOf", [ROLES.investor.address]), 1_000n * U);
    assert.equal(await read(PAXOS, "MockUSDG", "totalSupply"), 11_875n * U);
    assert.equal(Number(await read(line, "LockgateCreditLine", "maxUtilizationBps")), 8000);
    const quote = await client.readContract({
      address: line as Address, abi: loadArtifact("LockgateCreditLine").abi, functionName: "quote", args: [fund, 1_000n * U],
    }) as readonly [bigint, number, boolean, string];
    assert.equal(quote[3], "");
    // The investor exits through the line: capital pays nav minus fee, no token is minted anywhere.
    const investor = createWalletClient({
      account: privateKeyToAccount(ROLES.investor.key), chain: { ...foundry, id: 421614 }, transport: http(rpc),
    });
    const write = async (address: string, name: string, functionName: string, args: unknown[]) => {
      const hash = await investor.writeContract({ address: address as Address, abi: loadArtifact(name).abi, functionName, args });
      assert.equal((await client.waitForTransactionReceipt({ hash })).status, "success");
    };
    await write(PAXOS, "MockUSDG", "approve", [fund, 1_000n * U]);
    await write(fund, "WeeklyCyclePlatform", "deposit", [1_000n * U]);
    const shares = await read(await read(fund, "WeeklyCyclePlatform", "share") as unknown as string, "PlatformShare", "balanceOf", [ROLES.investor.address]);
    await write(fund, "WeeklyCyclePlatform", "exitNow", [shares, 0n]);
    const paid = await read(PAXOS, "MockUSDG", "balanceOf", [ROLES.investor.address]);
    assert.ok(paid > 900n * U && paid < 1_000n * U);
    assert.equal(await read(line, "LockgateCreditLine", "capital"), 10_000n * U - paid);
    assert.equal(await read(PAXOS, "MockUSDG", "totalSupply"), 11_875n * U);
  }, 421614);
});

test("paxos deploy refuses before any transaction when the deployer is short", { timeout: 60_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await fakePaxos(rpc, 10_874n);
    const client = createPublicClient({ chain: foundry, transport: http(rpc) });
    const nonce = await client.getTransactionCount({ address: ROLES.lockgate.address });
    await assert.rejects(
      () => broadcastSepolia({ ...ENV, SEPOLIA_RPC: rpc }, manifestFile),
      (err: unknown) => err instanceof HarnessError && err.code === "INSUFFICIENT_USDG",
    );
    assert.equal(await client.getTransactionCount({ address: ROLES.lockgate.address }), nonce);
  }, 421614);
});
