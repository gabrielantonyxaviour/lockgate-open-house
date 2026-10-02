import assert from "node:assert/strict";
import { test } from "node:test";
import { draw, residual } from "../src/books.js";
import { pickBestFee, pickProRata, pickRoundRobin, type VaultOffer } from "../src/mandate.js";
import { u } from "../src/params.js";
import { repayFirstBroken, settleQueue } from "../src/window.js";
import { buildWorld, type ExitReq } from "../src/world.js";

function advance(nav: number, fee: number): Omit<ExitReq, "line" | "platform"> {
  return {
    nav, fee, principal: nav - fee, advanced: true, dueDay: 1, open: true,
    feeBps: 100, misses: 0, lastMissDay: -1,
  };
}

test("short cash repays the advance and pays no waiting investor", () => {
  const world = buildWorld("stage1", 7);
  const line = world.lines[0]!;
  const platform = world.platforms[0]!;
  const first = advance(u(10_000), u(100));
  const second = advance(u(8_000), u(80));
  draw(line, platform.id, first.principal, first.nav);
  draw(line, platform.id, second.principal, second.nav);
  platform.reqs.push(
    { ...first, line, platform: platform.id },
    { ...second, line, platform: platform.id },
    { nav: u(5_000), fee: 0, principal: 0, advanced: false, dueDay: 1, open: true, line: null, platform: platform.id, feeBps: 0, misses: 0, lastMissDay: -1 },
  );
  platform.cash = u(10_000);
  settleQueue(world, platform, 1);
  assert.equal(platform.reqs[0]!.open, false);
  assert.equal(platform.reqs[1]!.open, true);
  assert.equal(platform.reqs[1]!.misses, 1);
  assert.equal(platform.reqs[2]!.open, true);
  assert.equal(world.investorPaid, 0);
  assert.equal(world.breaches, 0);
  assert.equal(residual(line), 0);
  assert.equal(line.realizedFees, u(100));
});

test("investors are paid only after every due advance", () => {
  const world = buildWorld("stage1", 7);
  const line = world.lines[0]!;
  const platform = world.platforms[0]!;
  const first = advance(u(6_000), u(60));
  draw(line, platform.id, first.principal, first.nav);
  platform.reqs.push(
    { ...first, line, platform: platform.id },
    { nav: u(1_000), fee: 0, principal: 0, advanced: false, dueDay: 1, open: true, line: null, platform: platform.id, feeBps: 0, misses: 0, lastMissDay: -1 },
  );
  platform.cash = u(7_000);
  settleQueue(world, platform, 1);
  assert.equal(platform.reqs[0]!.open, false);
  assert.equal(platform.reqs[1]!.open, false);
  assert.equal(world.investorPaid, u(1_000));
  assert.equal(world.breaches, 0);
});

test("an unbooked advance does not pay investors or spend cash", () => {
  const world = buildWorld("stage1", 7);
  const platform = world.platforms[0]!;
  platform.reqs.push(
    {
      nav: 100, fee: 1, principal: 99, advanced: true, dueDay: 1, open: true,
      line: null, platform: platform.id, feeBps: 100, misses: 0, lastMissDay: -1,
    },
    {
      nav: 50, fee: 0, principal: 0, advanced: false, dueDay: 1, open: true,
      line: null, platform: platform.id, feeBps: 0, misses: 0, lastMissDay: -1,
    },
  );
  platform.cash = 1_000;
  settleQueue(world, platform, 1);
  assert.equal(platform.reqs[0]!.open, true);
  assert.equal(platform.reqs[1]!.open, true);
  assert.equal(platform.cash, 1_000);
  assert.equal(world.investorPaid, 0);
  assert.equal(world.breaches, 0);
  assert.equal(repayFirstBroken(platform.reqs[0]!.open, world.investorPaid), false);
  assert.equal(repayFirstBroken(platform.reqs[0]!.open, 50), true);
  assert.equal(repayFirstBroken(false, 50), false);
});

test("router modes pick the cheapest, the next cursor, or the larger idle vault", () => {
  const offers: VaultOffer[] = [
    { index: 0, feeBps: 80, principal: 1, idle: 10 },
    { index: 1, feeBps: 40, principal: 1, idle: 5 },
    { index: 2, feeBps: 40, principal: 1, idle: 50 },
  ];
  assert.equal(pickBestFee(offers)?.index, 2);
  assert.equal(pickRoundRobin(offers, 0)?.offer.index, 0);
  assert.equal(pickRoundRobin(offers, 1)?.offer.index, 1);
  assert.equal(pickRoundRobin(offers, 3)?.offer.index, 0);
  assert.equal(pickProRata(offers, 0)?.index, 0);
  assert.equal(pickProRata(offers, 10)?.index, 1);
  assert.equal(pickProRata(offers, 15)?.index, 2);
  assert.equal(pickProRata([], 0), null);
});
