import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS } from "../src/actions/catalog.js";
import { books } from "../src/actions/stage3.js";
import { loadCtx, read, type Ctx } from "../src/chain.js";
import { deployProtocol } from "../src/deploy.js";
import { readManifest } from "../src/manifest.js";
import { ROLES } from "../src/roles.js";
import { startServer } from "../src/server.js";
import { parseUsdg } from "../src/units.js";
import { withAnvil } from "./anvil.js";

const STAGE = ACTIONS.map((action) => action.id).filter((id) => /^stage[123]\./.test(id));

type Step = { action: string; input?: Record<string, string>; save?: Record<string, string> };

/** One successful console call per stage action. Gate and pause are toggled back so later calls can land. */
const STEPS: Step[] = [
  { action: "stage2.assertNoLockgateControl" },
  { action: "stage1.registerPlatform", input: { kind: "1", initialShares: "0" } },
  { action: "stage1.depositCapital", input: { amountUsdg: "100000" } },
  { action: "stage1.postReserve", input: { amountUsdg: "2000" } },
  { action: "stage1.quote", input: { navUsdg: "1000" } },
  { action: "stage1.setGated", input: { gated: "true" } },
  { action: "stage1.setGated", input: { gated: "false" } },
  { action: "stage1.pause", input: { paused: "true" } },
  { action: "stage1.pause", input: { paused: "false" } },
  { action: "stage1.buyShares", input: { shares: "6000" } },
  { action: "stage1.requestRedeem", input: { shares: "100" } },
  { action: "stage1.depositCash", input: { amountUsdg: "200" } },
  { action: "stage1.processWindow" },
  { action: "stage1.exitNow", input: { shares: "100" }, save: { smallAdvance: "advanceId" } },
  { action: "stage1.repay", input: { advanceId: "{smallAdvance}" } },
  { action: "stage1.draw", input: { shares: "5000" }, save: { largeAdvance: "advanceId" } },
  { action: "stage2.setMandate", input: { vault: "PartnerVaultA", minFeeBps: "25" } },
  { action: "stage2.approvePlatform", input: { vault: "PartnerVaultA" } },
  { action: "stage2.deposit", input: { vault: "PartnerVaultA", amountUsdg: "20000" } },
  { action: "stage2.postReserve", input: { vault: "PartnerVaultA", amountUsdg: "200" } },
  { action: "stage2.enlist", input: { vault: "PartnerVaultA" } },
  { action: "stage2.setPolicy", input: { policy: "0" } },
  { action: "stage2.preview", input: { navUsdg: "1000", strategy: "0" } },
  { action: "stage2.routedAdvance", input: { navUsdg: "1000", strategy: "0", nonce: "1" }, save: { exitRef: "exitRef" } },
  { action: "stage2.repay", input: { exitRef: "{exitRef}" } },
  { action: "stage2.payInvestor", input: { amountUsdg: "1" } },
  { action: "stage2.approve", input: { navUsdg: "400", strategy: "0", nonce: "4" } },
  { action: "stage3.depositSenior", input: { amountUsdg: "10000" } },
  { action: "stage3.depositJunior", input: { amountUsdg: "4000" } },
  { action: "stage3.draw", input: { amountUsdg: "2000" } },
  { action: "stage3.repay", input: { amountUsdg: "10" } },
  { action: "stage3.waterfall", input: { amountUsdg: "10", warpDays: "1" } },
  { action: "stage1.markLate", input: { advanceId: "{largeAdvance}" } },
  { action: "stage2.proposeUpgrade", input: { vault: "PartnerVaultA" } },
  { action: "stage3.recognizeLoss" },
];

test("console smoke runs every stage action on local Anvil", { timeout: 300_000 }, async () => {
  const covered = new Set(STEPS.map((step) => step.action));
  for (const id of STAGE) assert.equal(covered.has(id), true, id);
  await withAnvil(async (rpc, manifestFile) => {
    assert.equal(new URL(rpc).hostname, "127.0.0.1");
    assert.notEqual(new URL(rpc).port, "8545");
    const manifest = await deployProtocol(rpc, manifestFile);
    assert.equal(manifest.chainId, 31337);
    const ctx = await loadCtx(readManifest(manifestFile), manifestFile);
    assert.equal(ctx.chainId, 31337);
    const server = await startServer(ctx, 0);
    try {
      const surface = await (await fetch(`${server.url}/api/surface`)).json() as { actions: Array<{ id: string }> };
      const listed = new Set(surface.actions.map((action) => action.id));
      for (const id of STAGE) assert.equal(listed.has(id), true, id);
      const ran = await runSteps(server.url, ctx);
      for (const id of STAGE) assert.equal(ran.has(id), true, id);
      await assertChain(ctx);
    } finally {
      await server.close();
    }
  });
});

async function runSteps(url: string, ctx: Ctx): Promise<Set<string>> {
  const ran = new Set<string>();
  const saved: Record<string, string> = {};
  for (const step of STEPS) {
    if (step.action === "stage3.draw") {
      const eligible = await read<bigint>(ctx, "LockgateCreditLine", "eligibleOutstanding");
      const base = await read<bigint>(ctx, "CreditFacility", "borrowingBase");
      assert.ok(base >= parseUsdg("2000"), `borrowing base ${base} eligible ${eligible} is below the 2000 draw`);
    }
    const input = fill(step.input ?? {}, saved);
    const result = await act(url, step.action, input);
    assertTiming(step.action, result);
    if (step.action === "stage1.quote") {
      assert.equal((result as { available?: boolean }).available, true);
    }
    if (step.action === "stage2.preview") {
      const slices = (result as { slices?: Array<{ vault?: string; feeBps?: number }> }).slices ?? [];
      assert.equal(slices.length, 1);
      assert.equal(slices[0]?.feeBps, 25);
      assert.equal(slices[0]?.vault?.toLowerCase(), ctx.binding("PartnerVaultA").address.toLowerCase());
    }
    for (const [bag, field] of Object.entries(step.save ?? {})) {
      const value = (result as Record<string, unknown>)[field];
      const pattern = field === "exitRef" ? /^0x[0-9a-fA-F]{64}$/ : /^[1-9][0-9]*$/;
      assert.match(String(value), pattern, `${step.action} ${field}`);
      saved[bag] = String(value);
    }
    ran.add(step.action);
  }
  return ran;
}

async function act(url: string, action: string, input: Record<string, string>): Promise<unknown> {
  const response = await fetch(`${url}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const body = await response.json() as { ok?: boolean; result?: unknown; error?: string; code?: string };
  assert.equal(response.status, 200, `${action} ${body.code ?? ""} ${body.error ?? ""}`);
  assert.equal(body.ok, true, action);
  assert.equal(body.code, undefined, action);
  return body.result;
}

function assertTiming(action: string, result: unknown): void {
  const timing = (result as { timing?: { elapsedMs?: number; gasUsed?: string } }).timing;
  assert.equal(Number.isSafeInteger(timing?.elapsedMs), true, action);
  assert.ok((timing?.elapsedMs ?? -1) >= 0, action);
  assert.match(timing?.gasUsed ?? "", /^\d+$/, action);
  if (action === "stage1.quote" || action === "stage2.preview" || action === "stage2.setPolicy") {
    assert.equal(timing?.gasUsed, "0", action);
  }
  if (action === "stage1.depositCapital") assert.notEqual(timing?.gasUsed, "0", action);
}

function fill(input: Record<string, string>, saved: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    const next = value.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const found = saved[name];
      if (!found) throw new Error(`missing ${name} for ${key}`);
      return found;
    });
    return [key, next];
  }));
}

async function assertChain(ctx: Ctx): Promise<void> {
  const weekly = ctx.binding("WeeklyQueuePlatform").address;
  assert.equal(await read<boolean>(ctx, "LockgateCreditLine", "paused"), false);
  assert.equal(await read<boolean>(ctx, "WeeklyQueuePlatform", "gated"), false);
  assert.equal(await read<bigint>(ctx, "LockgateCreditLine", "reserveOf", [weekly]), 0n);
  assert.equal(await advanceStatus(ctx, 1n), 1);
  assert.equal(await advanceStatus(ctx, 2n), 2);
  assert.equal(await read<bigint>(ctx, "WeeklyQueuePlatform", "requestCount"), 3n);

  const owner = await read<string>(ctx, "PartnerVaultA", "owner");
  assert.notEqual(owner.toLowerCase(), ROLES.lockgate.address.toLowerCase());
  assert.equal(await read<boolean>(ctx, "PartnerVaultA", "nonceUsed", [1n]), true);
  assert.equal(await read<boolean>(ctx, "PartnerVaultA", "nonceUsed", [4n]), true);
  assert.equal(await read<bigint>(ctx, "PartnerVaultA", "owedOf", [1n]), 0n);
  assert.ok(await read<bigint>(ctx, "PartnerVaultA", "owedOf", [2n]) > 0n);
  const now = (await ctx.publicClient.getBlock()).timestamp;
  assert.ok(await read<bigint>(ctx, "PartnerVaultA", "scheduledEta") > now);
  assert.equal(await read<bigint>(ctx, "Router", "vaultCount"), 1n);

  assert.equal(ctx.manifest.contracts.LockgateExitPool, undefined);

  const state = await books(ctx);
  assert.equal(state.recovery, true);
  assert.equal(state.seniorPrincipal, parseUsdg("10000"));
  assert.ok(state.juniorPrincipal > 0n);
  assert.ok(state.juniorPrincipal < parseUsdg("4000"));
  assert.ok(state.drawn < parseUsdg("2000"));
}

async function advanceStatus(ctx: Ctx, id: bigint): Promise<number> {
  const value = await read<unknown>(ctx, "LockgateCreditLine", "getAdvance", [id]);
  if (value && typeof value === "object" && "status" in value) return Number((value as { status: number }).status);
  return Number((value as unknown[])[6]);
}
