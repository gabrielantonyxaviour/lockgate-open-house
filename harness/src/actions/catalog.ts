import { send, type Ctx } from "../chain.js";
import { isRole, type RoleName } from "../roles.js";
import { parseUsdg } from "../units.js";
import { demoAll, demoStage1, demoStage2, demoStage3 } from "./demo.js";
import { status } from "./read.js";
import {
  buyShares, depositCapital, depositCash, draw, exitNow, markLate, pauseLine, postReserve, processWindow, quote,
  registerPlatform, repay, requestRedeem, setGated,
} from "./stage1.js";
import {
  approvePlatform, approveProposal, assertLockgateHasNoControl, depositVault, enlist, payInvestor, postVaultReserve,
  preview, proposeUpgrade, repayRoute, routedAdvance, setMandate, setPolicy,
} from "./stage2.js";
import { depositJunior, depositSenior, drawFacility, recognizeLoss, repayFacility, waterfall } from "./stage3.js";

export type Field = { name: string; label: string; default?: string };
export type Action = {
  id: string;
  summary: string;
  fields: Field[];
  run: (ctx: Ctx, input: Record<string, string>) => Promise<unknown>;
};

async function faucet(ctx: Ctx, input: Record<string, string>): Promise<unknown> {
  const role: RoleName = input.role && isRole(input.role) ? input.role : "investor";
  const amount = parseUsdg(input.amountUsdg ?? "1000");
  const hash = await send(ctx, role, "MockUSDG", "faucet", [amount]);
  return { hash, role, amount: input.amountUsdg ?? "1000" };
}

export const ACTIONS: Action[] = [
  { id: "read.status", summary: "Read balances, the credit line, vaults and the facility", fields: [], run: (ctx) => status(ctx) },
  { id: "token.faucet", summary: "Take test USDG from the faucet (max 10000 per call)", fields: [{ name: "role", label: "role", default: "investor" }, { name: "amountUsdg", label: "USDG", default: "1000" }], run: faucet },
  { id: "stage1.registerPlatform", summary: "Deploy a sandbox platform and register it (kind 1 weekly, 2 epoch, 3 quarterly)", fields: [{ name: "kind", label: "kind", default: "1" }, { name: "limitUsdg", label: "limit", default: "25000" }, { name: "reserveBps", label: "reserve bps", default: "750" }, { name: "initialShares", label: "unbacked shares", default: "0" }], run: registerPlatform },
  { id: "stage1.postReserve", summary: "Post the platform first-loss reserve", fields: [{ name: "platform", label: "platform", default: "WeeklyQueuePlatform" }, { name: "amountUsdg", label: "USDG", default: "2000" }], run: postReserve },
  { id: "stage1.depositCapital", summary: "Deposit Lockgate's own USDG", fields: [{ name: "amountUsdg", label: "USDG", default: "100000" }], run: depositCapital },
  { id: "stage1.quote", summary: "Quote an exit on the credit line", fields: [{ name: "navUsdg", label: "NAV USDG", default: "1000" }, { name: "platform", label: "platform", default: "WeeklyQueuePlatform" }], run: quote },
  { id: "stage1.buyShares", summary: "Investor buys non-moving shares", fields: [{ name: "shares", label: "whole shares", default: "100" }, { name: "platform", label: "platform", default: "WeeklyQueuePlatform" }], run: buyShares },
  { id: "stage1.draw", summary: "Investor exits now. The platform draws nav and pays principal.", fields: [{ name: "shares", label: "whole shares", default: "1000" }, { name: "platform", label: "platform", default: "WeeklyQueuePlatform" }], run: draw },
  { id: "stage1.repay", summary: "Fund the platform and process the window, which repays Lockgate first", fields: [{ name: "advanceId", label: "advance id", default: "1" }], run: repay },
  { id: "stage1.markLate", summary: "Warp past grace and slash the reserve", fields: [{ name: "advanceId", label: "advance id", default: "1" }], run: markLate },
  { id: "stage1.depositCash", summary: "Push matured cash into the platform", fields: [{ name: "amountUsdg", label: "USDG", default: "1000" }], run: depositCash },
  { id: "stage1.processWindow", summary: "Repay Lockgate before the investor queue", fields: [], run: (ctx) => processWindow(ctx) },
  { id: "stage1.requestRedeem", summary: "Investor joins the queue", fields: [{ name: "shares", label: "whole shares", default: "100" }], run: requestRedeem },
  { id: "stage1.exitNow", summary: "Same draw path as stage1.draw", fields: [{ name: "shares", label: "whole shares", default: "100" }], run: exitNow },
  { id: "stage1.setGated", summary: "Gate or ungate the platform", fields: [{ name: "gated", label: "true or false", default: "true" }], run: setGated },
  { id: "stage1.pause", summary: "Pause or unpause the credit line", fields: [{ name: "paused", label: "true or false", default: "true" }], run: pauseLine },
  { id: "stage2.setMandate", summary: "Partner sets min fee, tenor, concentration and expiry", fields: [{ name: "vault", label: "vault", default: "PartnerVaultA" }, { name: "minFeeBps", label: "min fee bps", default: "25" }], run: setMandate },
  { id: "stage2.approvePlatform", summary: "Partner approves a platform, payout, proposer and router", fields: [{ name: "vault", label: "vault", default: "PartnerVaultA" }, { name: "limitUsdg", label: "limit", default: "20000" }], run: approvePlatform },
  { id: "stage2.postReserve", summary: "Partner posts a vault reserve for the platform", fields: [{ name: "vault", label: "vault", default: "PartnerVaultA" }, { name: "amountUsdg", label: "USDG", default: "200" }], run: postVaultReserve },
  { id: "stage2.deposit", summary: "Partner deposits USDG into their own vault", fields: [{ name: "vault", label: "vault", default: "PartnerVaultA" }, { name: "amountUsdg", label: "USDG", default: "20000" }], run: depositVault },
  { id: "stage2.enlist", summary: "Partner registers the vault. Lockgate cannot.", fields: [{ name: "vault", label: "vault", default: "PartnerVaultA" }], run: enlist },
  { id: "stage2.setPolicy", summary: "Strategy is chosen per quote: 0 best fee, 1 pro-rata, 2 round-robin", fields: [{ name: "policy", label: "strategy", default: "0" }], run: setPolicy },
  { id: "stage2.preview", summary: "Ask the router which vault would fund an exit", fields: [{ name: "navUsdg", label: "NAV USDG", default: "1000" }, { name: "strategy", label: "strategy", default: "0" }], run: preview },
  { id: "stage2.routedAdvance", summary: "Engine proposes, partner signs, a third party executes", fields: [{ name: "navUsdg", label: "NAV USDG", default: "1000" }, { name: "strategy", label: "strategy", default: "0" }, { name: "nonce", label: "nonce", default: "1" }], run: routedAdvance },
  { id: "stage2.approve", summary: "Engine files the proposal. The partner approve pays. Lockgate cannot approve.", fields: [{ name: "navUsdg", label: "NAV USDG", default: "400" }, { name: "strategy", label: "strategy", default: "0" }, { name: "nonce", label: "nonce", default: "4" }], run: approveProposal },
  { id: "stage2.repay", summary: "Repay a routed advance back to the funding vault", fields: [{ name: "exitRef", label: "exit ref" }], run: repayRoute },
  { id: "stage2.payInvestor", summary: "Platform forwards advance cash to the investor", fields: [{ name: "amountUsdg", label: "USDG", default: "990" }], run: payInvestor },
  { id: "stage2.proposeUpgrade", summary: "Partner schedules a timelocked implementation", fields: [{ name: "vault", label: "vault", default: "PartnerVaultA" }], run: proposeUpgrade },
  { id: "stage2.assertNoLockgateControl", summary: "Show Lockgate cannot move, pause, mandate or enlist", fields: [], run: (ctx) => assertLockgateHasNoControl(ctx) },
  { id: "stage3.depositSenior", summary: "Approved senior lender deposits", fields: [{ name: "amountUsdg", label: "USDG", default: "10000" }], run: depositSenior },
  { id: "stage3.depositJunior", summary: "Approved junior lender deposits", fields: [{ name: "amountUsdg", label: "USDG", default: "4000" }], run: depositJunior },
  { id: "stage3.draw", summary: "Lockgate draws the facility against its own book", fields: [{ name: "amountUsdg", label: "USDG", default: "2000" }], run: drawFacility },
  { id: "stage3.repay", summary: "Repay the facility. Senior interest is paid first.", fields: [{ name: "amountUsdg", label: "USDG", default: "10" }], run: repayFacility },
  { id: "stage3.recognizeLoss", summary: "Enter recovery and write the uncovered draw junior-first", fields: [], run: (ctx) => recognizeLoss(ctx) },
  { id: "stage3.waterfall", summary: "Accrue, repay, and let the senior withdraw interest", fields: [{ name: "amountUsdg", label: "USDG", default: "10" }], run: waterfall },
  { id: "demo.stage1", summary: "Run the stage 1 script", fields: [], run: (ctx) => demoStage1(ctx) },
  { id: "demo.stage2", summary: "Run the stage 2 script", fields: [], run: (ctx) => demoStage2(ctx) },
  { id: "demo.stage3", summary: "Run the stage 3 script", fields: [], run: (ctx) => demoStage3(ctx) },
  { id: "demo.all", summary: "Run every stage on one chain", fields: [], run: (ctx) => demoAll(ctx) },
];

export function findAction(id: string): Action | undefined {
  return ACTIONS.find((action) => action.id === id);
}

export function surface(): Array<{ id: string; summary: string; fields: Field[] }> {
  return ACTIONS.map(({ id, summary, fields }) => ({ id, summary, fields }));
}
