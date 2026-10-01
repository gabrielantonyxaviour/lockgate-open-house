import { canDraw, draw, exposureBps, postReserve, repay, reserveNeed, utilizationBps, type Line } from "./books.js";
import { mandateReject, pickBestFee, type VaultOffer } from "./mandate.js";
import { MAX_FEE_BPS, MAX_NAV_AGE_SECONDS } from "./params.js";
import { feeFromBps, quoteFee } from "./pricing.js";
import { covenantBroken, DAY, type ExitReq, type Platform, type World } from "./world.js";

export function reject(world: World, reason: string): void {
  world.rejected[reason] = (world.rejected[reason] ?? 0) + 1;
}

export function modelBps(line: Line, platform: Platform, day: number, dueDay: number, gated: boolean):
  | { ok: true; bps: number }
  | { ok: false; reason: string } {
  const quote = quoteFee({
    secondsToWindow: Math.max(0, dueDay - day) * DAY,
    navAgeSeconds: platform.navAgeDays * DAY,
    gated,
    exposureBps: exposureBps(line, platform.id),
    utilizationBps: utilizationBps(line),
    riskBps: platform.riskBps,
    timeScale: 1,
  });
  if (!quote.available) return { ok: false, reason: quote.reason };
  return { ok: true, bps: quote.bps };
}

function totalExposure(world: World, platform: string): number {
  let n = 0;
  for (const line of world.lines) n += line.exposure[platform] ?? 0;
  return n;
}

function reserveShort(line: Line, platform: Platform, owed: number): number {
  const exposure = (line.exposure[platform.id] ?? 0) + owed;
  const need = reserveNeed(exposure, platform.reserveBps);
  const have = line.reserves[platform.id] ?? 0;
  return Math.max(0, need - have);
}

function undoReserve(line: Line, platform: Platform, short: number): void {
  platform.reserveBudget += short;
  line.balance -= short;
  line.reserve -= short;
  const next = (line.reserves[platform.id] ?? 0) - short;
  if (next === 0) delete line.reserves[platform.id];
  else line.reserves[platform.id] = next;
}

function commitDraw(world: World, platform: Platform, line: Line, nav: number, feeBps: number, dueDay: number, limit: number): boolean {
  const fee = feeFromBps(nav, feeBps);
  if (fee <= 0 || fee >= nav) {
    reject(world, "fee-dust");
    return false;
  }
  const principal = nav - fee;
  if (totalExposure(world, platform.id) + nav > platform.limit) {
    reject(world, "over-limit");
    return false;
  }
  const short = reserveShort(line, platform, nav);
  if (short > platform.reserveBudget) {
    reject(world, "reserve-short");
    return false;
  }
  if (line.balance - line.reserve < principal) {
    reject(world, "capital-short");
    return false;
  }
  if ((line.exposure[platform.id] ?? 0) + nav > limit) {
    reject(world, "over-limit");
    return false;
  }
  if (short > 0) {
    platform.reserveBudget -= short;
    postReserve(line, platform.id, short);
  }
  const check = canDraw(line, platform.id, principal, nav, platform.reserveBps, limit);
  if (!check.ok) {
    if (short > 0) undoReserve(line, platform, short);
    reject(world, check.reason);
    return false;
  }
  draw(line, platform.id, principal, nav);
  platform.reqs.push({
    nav, fee, principal, advanced: true, dueDay, open: true, line,
    platform: platform.id, feeBps, misses: 0, lastMissDay: -1,
  });
  world.advanced += 1;
  return true;
}

/** Best execution: the eligible partner vault with the lowest fee. */
export function fundExit(world: World, platform: Platform, nav: number, day: number, dueDay: number, gated: boolean): void {
  world.requested += 1;
  if (platform.dead) {
    reject(world, "defaulted");
    return;
  }
  if (gated) {
    reject(world, "gated");
    return;
  }
  if (platform.navAgeDays * DAY > MAX_NAV_AGE_SECONDS) {
    reject(world, "stale-nav");
    return;
  }
  if (world.stage !== "stage2") {
    const line = world.lines[0]!;
    if (covenantBroken(world.facility)) {
      reject(world, "covenant");
      return;
    }
    const quote = modelBps(line, platform, day, dueDay, false);
    if (!quote.ok) {
      reject(world, quote.reason);
      return;
    }
    commitDraw(world, platform, line, nav, quote.bps, dueDay, platform.limit);
    return;
  }
  const offers: VaultOffer[] = [];
  let blocked: string | null = null;
  for (let i = 0; i < world.vaults.length; i += 1) {
    const vault = world.vaults[i]!;
    const quote = modelBps(vault.line, platform, day, dueDay, false);
    if (!quote.ok) {
      blocked = quote.reason;
      continue;
    }
    const feeBps = Math.max(quote.bps, vault.mandate.minFeeBps);
    if (feeBps > MAX_FEE_BPS) {
      blocked = "mandate-fee";
      continue;
    }
    const fee = feeFromBps(nav, feeBps);
    if (fee <= 0 || fee >= nav) continue;
    const principal = nav - fee;
    const why = mandateReject(vault.line, vault.mandate, {
      platform: platform.id, day, feeBps,
      tenorSeconds: Math.max(0, dueDay - day) * DAY,
      principal,
      owed: nav,
    });
    if (why) {
      blocked = why;
      continue;
    }
    if (reserveShort(vault.line, platform, nav) > platform.reserveBudget) {
      blocked = "reserve-short";
      continue;
    }
    if (vault.line.balance - vault.line.reserve < principal) {
      blocked = "capital-short";
      continue;
    }
    offers.push({
      index: i, feeBps, principal,
      idle: Math.max(0, vault.line.balance - vault.line.reserve),
    });
  }
  const picked = pickBestFee(offers);
  if (!picked) {
    reject(world, blocked ?? "no-vault");
    return;
  }
  const vault = world.vaults[picked.index]!;
  if (commitDraw(world, platform, vault.line, nav, picked.feeBps, dueDay, vault.mandate.limit)) {
    world.cursor = picked.index;
  }
}

export function settleAdvance(req: ExitReq): void {
  if (!req.line) return;
  repay(req.line, req.platform, req.principal, req.fee);
  req.open = false;
}
