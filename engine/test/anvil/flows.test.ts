import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { monthEpoch } from "../../src/examples.js";
import { assessFacility } from "../../src/facility/assess.js";
import { accrue, onRepay, type FacilityBooks } from "../../src/facility/math.js";
import { DEFAULT_PARAMS } from "../../src/pricing/defaults.js";
import { buildProposal } from "../../src/proposal/build.js";
import { filePartnerProposal } from "../../src/proposal/partner.js";
import { signBuiltProposal } from "../../src/proposal/sign.js";
import { mandateDrift, previewReason, readVaultFacts } from "../../src/proposal/vaultread.js";
import { broadcastOwnBook, planSweep } from "../../src/sweep/sweep.js";
import { artifact, KEYS, raw, read, send, stamp, startAnvil, type Anvil } from "./chain.js";
import { approve, deployWorld, U, type World } from "./deploy.js";

const DAY = 86_400;

type Books = {
  cash: bigint;
  drawn: bigint;
  seniorPrincipal: bigint;
  juniorPrincipal: bigint;
  seniorDeficit: bigint;
  juniorDeficit: bigint;
  seniorInterestDue: bigint;
  juniorInterestDue: bigint;
  seniorInterestCash: bigint;
  juniorInterestCash: bigint;
  residual: bigint;
  locked: bigint;
  seniorAprBps: bigint;
  juniorAprBps: bigint;
  advanceRateBps: number;
  maxLateBps: number;
  minJuniorBps: number;
  lastAccrual: bigint;
  recovery: boolean;
};

function asBooks(row: Books): FacilityBooks {
  return {
    cash: row.cash,
    drawn: row.drawn,
    seniorPrincipal: row.seniorPrincipal,
    juniorPrincipal: row.juniorPrincipal,
    seniorDeficit: row.seniorDeficit,
    juniorDeficit: row.juniorDeficit,
    seniorInterestDue: row.seniorInterestDue,
    juniorInterestDue: row.juniorInterestDue,
    seniorInterestCash: row.seniorInterestCash,
    juniorInterestCash: row.juniorInterestCash,
    residual: row.residual,
    locked: row.locked,
    seniorAprBps: row.seniorAprBps,
    juniorAprBps: row.juniorAprBps,
    lastAccrual: Number(row.lastAccrual),
    recovery: row.recovery,
  };
}

async function balance(world: World, account: Address): Promise<bigint> {
  return read<bigint>(world.node, world.usdg, world.usdgAbi, "balanceOf", [account]);
}

describe.sequential("anvil stages 1-3", () => {
  let node: Anvil;
  let world: World;
  let fund: Address;

  beforeAll(async () => {
    node = await startAnvil();
    world = await deployWorld(node);
    expect(node.port).toBeGreaterThanOrEqual(8546);
    expect(await node.publicClient.getChainId()).toBe(31337);
  }, 120_000);

  afterAll(() => node?.stop());

  it("draws and repays a stage-1 exit on the credit line", async () => {
    const issuer = node.account(1).address;
    const exit = 10_000n * U;
    await send(node, 0, world.factory, world.factoryAbi, "createPlatform", [
      1, "Northwind weekly", 600n, 1_000_000n, issuer, 100_000n * U, 750,
    ]);
    const funds = await read<Address[]>(node, world.factory, world.factoryAbi, "fundsOf", [issuer]);
    fund = getAddress(funds[funds.length - 1]!);
    const fundAbi = artifact("WeeklyCyclePlatform").abi;
    await approve(world, 0, world.line, 50_000n * U);
    await send(node, 0, world.line, world.lineAbi, "depositCapital", [50_000n * U]);
    await approve(world, 1, world.line, 750n * U);
    await send(node, 1, world.line, world.lineAbi, "postReserve", [fund, 750n * U]);
    await approve(world, 1, fund, exit);
    await send(node, 1, fund, fundAbi, "deposit", [exit]);
    const quoted = await read<[bigint, number, boolean, string]>(node, world.line, world.lineAbi, "quote", [fund, exit]);
    expect(quoted[2]).toBe(true);
    const priced = await read<[number, boolean, string]>(
      node, world.pricing, world.pricingAbi, "feeBps", [600n, 0n, false, 0, 0],
    );
    expect(priced[0]).toBe(99);
    expect(priced[1]).toBe(true);
    const share = await read<Address>(node, fund, fundAbi, "share");
    const shares = await read<bigint>(node, share, world.usdgAbi, "balanceOf", [issuer]);
    const before = await balance(world, issuer);
    await send(node, 1, fund, fundAbi, "exitNow", [shares, 0n]);
    const drawn = await read<{ principal: bigint; fee: bigint }>(node, world.line, world.lineAbi, "getAdvance", [1n]);
    expect(await balance(world, issuer) - before).toBe(drawn.principal);
    expect(drawn.principal + drawn.fee).toBe(exit);
    const dueAt = Number(await read<bigint>(node, fund, fundAbi, "nextWindow"));
    const now = Number((await node.publicClient.getBlock()).timestamp);
    const advance = {
      id: 1n,
      vault: world.line,
      platform: fund,
      navValue: exit,
      dueAt,
      status: "active" as const,
      cash: await read<bigint>(node, fund, fundAbi, "cash"),
      vaultKind: "own-book" as const,
    };
    expect(planSweep({ chainId: 31337, now, graceSeconds: DAY, advances: [advance] })[0]?.kind).toBe("pending");
    const due = planSweep({ chainId: 31337, now: dueAt, graceSeconds: DAY, advances: [advance] });
    expect(due[0]?.kind).toBe("repay");
    expect(due[0]?.sendable).toBe(true);
    await stamp(node, dueAt);
    await broadcastOwnBook(due, 31337, world.line, (tx) => raw(node, 0, tx.to, tx.data!));
    expect(await read<bigint>(node, world.line, world.lineAbi, "remainingOf", [1n])).toBe(0n);
    await send(node, 1, fund, fundAbi, "processWindow", []);
    expect(Number(await read<bigint>(node, fund, fundAbi, "nextWindow"))).toBeGreaterThan(dueAt);
  }, 60_000);

  it("files a stage-2 proposal and lets the partner, not the engine, pay it", async () => {
    const now = Number((await node.publicClient.getBlock()).timestamp);
    const platform = fund;
    const partner = node.account(2).address;
    expect(partner).not.toBe(node.account(0).address);
    await send(node, 2, world.vault, world.vaultAbi, "setMandate", [10, 40n * BigInt(DAY), 5_000, BigInt(now + 40 * DAY)]);
    await send(node, 2, world.vault, world.vaultAbi, "setPlatform", [platform, true, 100_000n * U, 750, false, BigInt(7 * DAY)]);
    await send(node, 2, world.vault, world.vaultAbi, "setProposer", [node.account(0).address]);
    await approve(world, 2, world.vault, 20_750n * U);
    await send(node, 2, world.vault, world.vaultAbi, "deposit", [20_000n * U]);
    await send(node, 2, world.vault, world.vaultAbi, "postReserve", [platform, 750n * U]);
    const built = buildProposal({
      input: monthEpoch(now),
      params: DEFAULT_PARAMS,
      mandate: {
        vault: world.vault,
        partner,
        signer: partner,
        approvedPlatforms: [platform],
        platformLimits: { [platform]: 100_000n * U },
        minFeeBps: 10,
        maxTenorSeconds: 40 * DAY,
        concentrationCapBps: 5_000,
        expiresAt: now + 40 * DAY,
        idle: 20_000n * U,
        totalAssets: 20_000n * U,
      },
      platform,
      recipient: platform,
      chainId: 31337,
      nonce: 4n,
    });
    expect(built.submittable, built.blocks.map((block) => block.code).join(",")).toBe(true);
    expect(built.partner.digest).toBe(built.digest);
    const facts = await readVaultFacts(node.publicClient, world.vault, platform, 4n);
    expect(facts.idle).toBe(20_000n * U);
    expect(facts.totalAssets).toBe(20_000n * U);
    expect(mandateDrift(built.mandate, platform, facts)).toEqual([]);
    expect(mandateDrift({ ...built.mandate, idle: 1n }, platform, facts)[0]?.code).toBe("vault-mismatch");
    expect(await previewReason(node.publicClient, world.vault, built.message)).toBe(0);
    const reason = await read<number>(node, world.vault, world.vaultAbi, "preview", [built.message]);
    expect(reason, `preview ${reason}`).toBe(0);
    expect(await read<string>(node, world.vault, world.vaultAbi, "hashTypedProposal", [built.message])).toBe(built.digest);
    const signature = await signBuiltProposal(built, KEYS[0]);
    await filePartnerProposal(
      built.partner,
      true,
      signature,
      31337,
      node.account(0).address,
      (tx) => raw(node, 0, tx.to, tx.data),
    );
    expect(await read<string>(node, world.vault, world.vaultAbi, "proposalHashOf", [4n])).toBe(built.digest);
    expect(await read<boolean>(node, world.vault, world.vaultAbi, "nonceUsed", [4n])).toBe(false);
    const before = await balance(world, platform);
    await send(node, 2, world.vault, world.vaultAbi, "approve", [built.message]);
    expect(await balance(world, platform) - before).toBe(built.message.payout);
    expect(await read<boolean>(node, world.vault, world.vaultAbi, "nonceUsed", [4n])).toBe(true);
    expect(await read<bigint>(node, world.vault, world.vaultAbi, "owedOf", [1n])).toBe(built.message.navValue);
  }, 60_000);

  it("sizes a stage-3 facility, then the borrower draws and repays", async () => {
    const eligible = 1_000_000n * U;
    await send(node, 0, world.book, world.bookAbi, "set", [eligible, 0n]);
    await send(node, 1, world.facility, world.facilityAbi, "approveLender", [node.account(3).address, true]);
    await send(node, 1, world.facility, world.facilityAbi, "approveLender", [node.account(4).address, true]);
    await approve(world, 3, world.facility, 500_000n * U);
    await approve(world, 4, world.facility, 500_000n * U);
    await send(node, 3, world.facility, world.facilityAbi, "deposit", [0, 500_000n * U]);
    await send(node, 4, world.facility, world.facilityAbi, "deposit", [1, 500_000n * U]);
    const stored = await read<Books>(node, world.facility, world.facilityAbi, "accounting");
    const view = await read<bigint>(node, world.facility, world.facilityAbi, "availableDraw");
    const assessed = assessFacility({
      now: Number(stored.lastAccrual),
      ...asBooks(stored),
      seniorAprBps: Number(stored.seniorAprBps),
      juniorAprBps: Number(stored.juniorAprBps),
      advanceRateBps: Number(stored.advanceRateBps),
      maxLateBps: Number(stored.maxLateBps),
      minJuniorBps: Number(stored.minJuniorBps),
      eligibleOutstanding: eligible,
      lateOutstanding: 0n,
      bookReadable: true,
      payout: 100_000n * U,
    });
    expect(assessed.breached).toBe(false);
    expect(assessed.availableDraw).toBe(view);
    expect(assessed.canFund).toBe(true);
    expect(await read<boolean>(node, world.facility, world.facilityAbi, "solvent")).toBe(true);
    const before = await balance(world, node.account(0).address);
    await send(node, 0, world.facility, world.facilityAbi, "draw", [100_000n * U]);
    expect(await balance(world, node.account(0).address) - before).toBe(100_000n * U);
    const opened = await read<Books>(node, world.facility, world.facilityAbi, "accounting");
    const at = Number(opened.lastAccrual) + 2_592_000;
    await stamp(node, at);
    await send(node, 0, world.facility, world.facilityAbi, "poke");
    const accrued = await read<Books>(node, world.facility, world.facilityAbi, "accounting");
    expect(accrued.seniorInterestDue).toBe(accrue(asBooks(opened), at).seniorInterestDue);
    expect(accrued.seniorInterestDue).toBeGreaterThan(0n);
    const repayAt = at + 1;
    const step = accrue(asBooks(accrued), repayAt);
    const amount = step.seniorInterestDue + 15_000_000n;
    await approve(world, 0, world.facility, amount);
    await stamp(node, repayAt);
    await send(node, 0, world.facility, world.facilityAbi, "repay", [amount]);
    const closed = await read<Books>(node, world.facility, world.facilityAbi, "accounting");
    const paid = onRepay(step, amount).state;
    expect(closed.drawn).toBe(paid.drawn);
    expect(closed.seniorInterestDue).toBe(paid.seniorInterestDue);
    expect(closed.seniorPrincipal).toBe(paid.seniorPrincipal);
  }, 60_000);
});
