import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToHex, hexToBytes, keccak256, toBytes, type Hex } from "viem";
import { failureBody, HarnessError } from "../src/errors.js";
import { startServer } from "../src/server.js";
import { deployNew, loadCtx, read, send, type Ctx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { proposalTuple, signProposal, type AdvanceProposal } from "../src/eip712.js";
import { readManifest } from "../src/manifest.js";
import { balanceOf, expect, expectRevert } from "../src/actions/common.js";
import {
  depositCapital, exitNow, postReserve, registerPlatform,
} from "../src/actions/stage1.js";
import {
  approvePlatform, approveProposal, depositVault, draftProposal, enlist, postVaultReserve, repayRoute,
  setMandate,
} from "../src/actions/stage2.js";
import { ROLES } from "../src/roles.js";
import { parseUsdg } from "../src/units.js";
import { withAnvil } from "./anvil.js";

test("the act route rejects a bad body before it touches a chain", async () => {
  const server = await startServer({} as Ctx, 0);
  try {
    const broken = await post(server.url, "{");
    assert.equal(broken.status, 400);
    assert.equal(broken.body.code, "VALIDATION");
    assert.equal(broken.body.error, "body is not JSON");
    const missing = await post(server.url, JSON.stringify({ input: {} }));
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, "VALIDATION");
    assert.equal(missing.body.error, "action body is invalid");
    const nested = await post(server.url, JSON.stringify({ action: "read.status", input: { role: { nested: true } } }));
    assert.equal(nested.status, 400);
    assert.equal(nested.body.code, "VALIDATION");
    assert.equal(nested.body.error, "action body is invalid");
    const unknown = await post(server.url, JSON.stringify({ action: "missing" }));
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.code, "UNKNOWN_ACTION");
    assert.equal(unknown.body.error, "Unknown action");
  } finally {
    await server.close();
  }
});

test("failure paths keep cash identity and fail closed", { timeout: 180_000 }, async () => {
  await withAnvil(async (rpc, manifestFile) => {
    await deployProtocol(rpc, manifestFile);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);

    await registerPlatform(ctx, { kind: "1", limitUsdg: "25000", reserveBps: "750", initialShares: "100" });
    await expectRevert(() => send(ctx, "platform", "WeeklyQueuePlatform", "processWindow", []), "WindowClosed");
    await depositCapital(ctx, { amountUsdg: "100000" });
    await postReserve(ctx, { amountUsdg: "2000" });
    await exitNow(ctx, { shares: "100" });
    const eligible = await read<bigint>(ctx, "LockgateCreditLine", "eligibleOutstanding");
    const late = await read<bigint>(ctx, "LockgateCreditLine", "lateOutstanding");
    const exposure = await read<bigint>(ctx, "LockgateCreditLine", "totalExposure");
    expect(eligible + late === exposure, "eligible plus late left total exposure", {
      eligible: eligible.toString(), late: late.toString(), exposure: exposure.toString(),
    });
    expect(eligible > 0n && late === 0n, "a fresh advance was not eligible", { eligible, late });

    await expectRevert(() => send(ctx, "investor", "LockgateCreditLine", "withdrawCapital", [1n]), "OwnableUnauthorizedAccount");
    await assert.rejects(
      () => send(ctx, "investor", "MockUSDG", "faucet", [10_001_000_000n]),
      (err: unknown) => {
        const body = failureBody(err);
        const text = JSON.stringify(body);
        return err instanceof HarnessError
          && body.code === "REVERT"
          && body.error.includes("FaucetCap")
          && !text.includes(ROLES.investor.key.slice(2))
          && Object.keys(body).every((key) => key === "error" || key === "code");
      },
    );
    await expectRevert(() => send(ctx, "investor", "CreditFacility", "draw", [1_000_000n]), "Unauthorized");

    await setMandate(ctx, { vault: "PartnerVaultA", minFeeBps: "25" });
    await approvePlatform(ctx, { vault: "PartnerVaultA" });
    await postVaultReserve(ctx, { vault: "PartnerVaultA", amountUsdg: "200" });
    await depositVault(ctx, { vault: "PartnerVaultA", amountUsdg: "20000" });
    await enlist(ctx, { vault: "PartnerVaultA" });
    await assertVaultCash(ctx);

    const bad = await draftProposal(ctx, { navUsdg: "300", strategy: "0", nonce: "7" });
    const badSig = flip(await signProposal(ctx.wallet("lockgate"), bad.proposal, ctx.chainId, bad.slice.vault));
    await expectRevert(
      () => send(ctx, "lockgate", bad.vault, "submitProposal", [proposalTuple(bad.proposal), badSig]),
      "BadEngineSig",
    );
    expect((await read<bigint>(ctx, bad.vault, "advanceCount")) === 0n, "a bad signature created an advance");

    const lockgateBefore = await balanceOf(ctx, ROLES.lockgate.address);
    const funded = await approveProposal(ctx, { navUsdg: "300", strategy: "0", nonce: "8", rejectLockgate: "true" }) as {
      exitRef: string; vault: string; fee: string;
    };
    expect(funded.vault === "PartnerVaultA", "approve funded the wrong vault", funded.vault);
    expect((await balanceOf(ctx, ROLES.lockgate.address)) === lockgateBefore, "approve paid Lockgate");
    await assertVaultCash(ctx);
    await assert.rejects(
      () => draftProposal(ctx, { navUsdg: "300", strategy: "0", nonce: "8" }),
      (err: unknown) => err instanceof HarnessError && err.code === "REPLAY",
    );
    const replay = manual(ctx, 8n, (await ctx.publicClient.getBlock()).timestamp);
    const replaySig = await signProposal(ctx.wallet("lockgate"), replay, ctx.chainId, ctx.binding("PartnerVaultA").address);
    await expectRevert(
      () => send(ctx, "lockgate", "PartnerVaultA", "submitProposal", [proposalTuple(replay), replaySig]),
      "NonceUsed",
    );

    await send(ctx, "partnerB", "PartnerVaultB", "setProposer", [ROLES.lockgate.address]);
    const foreign = await draftProposal(ctx, { navUsdg: "300", strategy: "0", nonce: "11" });
    const foreignSig = await signProposal(ctx.wallet("lockgate"), foreign.proposal, ctx.chainId, foreign.slice.vault);
    await expectRevert(
      () => send(ctx, "lockgate", "PartnerVaultB", "submitProposal", [proposalTuple(foreign.proposal), foreignSig]),
      "BadEngineSig",
    );
    const pinned = await read<Hex>(ctx, "PartnerVaultB", "proposalHashOf", [11n]);
    expect(pinned === `0x${"0".repeat(64)}`, "a foreign signature pinned the other vault's nonce", pinned);

    const routerBefore = await balanceOf(ctx, ctx.binding("Router").address);
    await send(ctx, "lockgate", "MockUSDG", "mint", [ROLES.platform.address, parseUsdg("300")]);
    await repayRoute(ctx, { exitRef: funded.exitRef });
    expect((await balanceOf(ctx, ctx.binding("Router").address)) === routerBefore, "router kept repayment cash");
    await assertVaultCash(ctx);

    const block = await ctx.publicClient.getBlock();
    const low = await deployNew(ctx, "lockgate", "PegOracle", [99_000_000n, block.timestamp]);
    await send(ctx, "partnerA", "PartnerVaultA", "setOracle", [low, 100_000_000n, 86_400n]);
    const peg = manual(ctx, 11n, block.timestamp);
    expect(Number(await read(ctx, "PartnerVaultA", "preview", [proposalTuple(peg)])) === 11, "a low peg was accepted");
    await fileAndReject(ctx, peg);

    const stale = await deployNew(ctx, "lockgate", "PegOracle", [100_000_000n, block.timestamp - 172_800n]);
    await send(ctx, "partnerA", "PartnerVaultA", "setOracle", [stale, 100_000_000n, 86_400n]);
    const aged = manual(ctx, 12n, block.timestamp);
    expect(Number(await read(ctx, "PartnerVaultA", "preview", [proposalTuple(aged)])) === 12, "a stale oracle was accepted");
    await fileAndReject(ctx, aged);
  });
});

async function post(url: string, body: string): Promise<{ status: number; body: { code?: string; error?: string } }> {
  const response = await fetch(`${url}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return { status: response.status, body: await response.json() as { code?: string; error?: string } };
}

function flip(sig: Hex): Hex {
  const bytes = hexToBytes(sig);
  const last = bytes[bytes.length - 1] ?? 0;
  bytes[bytes.length - 1] = last ^ 0x01;
  return bytesToHex(bytes);
}

async function assertVaultCash(ctx: Ctx): Promise<void> {
  const vault = ctx.binding("PartnerVaultA").address;
  const cash = await balanceOf(ctx, vault);
  const idle = await read<bigint>(ctx, "PartnerVaultA", "idle");
  const reserve = await read<bigint>(ctx, "PartnerVaultA", "reserveCash");
  expect(cash === idle + reserve, "vault tokens left idle plus reserve", {
    cash: cash.toString(), idle: idle.toString(), reserve: reserve.toString(),
  });
}

function manual(ctx: Ctx, nonce: bigint, now: bigint): AdvanceProposal {
  const navValue = parseUsdg("200");
  const fee = (navValue * 25n + 9_999n) / 10_000n;
  return {
    platform: ctx.binding("WeeklyQueuePlatform").address,
    recipient: ROLES.platform.address,
    requestId: nonce,
    navValue,
    fee,
    payout: navValue - fee,
    feeBps: 25,
    dueAt: now + 3_600n,
    expiresAt: now + 86_400n,
    nonce,
    quoteId: keccak256(toBytes(`lockgate.failure.${nonce}`)),
  };
}

async function fileAndReject(ctx: Ctx, proposal: AdvanceProposal): Promise<void> {
  const sig = await signProposal(ctx.wallet("lockgate"), proposal, ctx.chainId, ctx.binding("PartnerVaultA").address);
  await send(ctx, "lockgate", "PartnerVaultA", "submitProposal", [proposalTuple(proposal), sig]);
  const idle = await read<bigint>(ctx, "PartnerVaultA", "idle");
  await expectRevert(() => send(ctx, "partnerA", "PartnerVaultA", "approve", [proposalTuple(proposal)]), "MandateRejected");
  expect((await read<bigint>(ctx, "PartnerVaultA", "idle")) === idle, "a rejected mandate moved cash");
}
