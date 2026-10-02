import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, render, type CompareSheet } from "../src/diverge.ts";

function sheet(patch?: Partial<CompareSheet>): CompareSheet {
  const base: CompareSheet = {
    block: 1,
    now: 1_800_000_000,
    nav: 10_000_000_000n,
    seconds: 600,
    timeScale: 4320,
    sim: { bps: 98, fee: 98_000_000n, agedBps: 98, rawBps: 98 },
    engine: { bps: 101, fee: 101_000_000n, payout: 9_899_000_000n, pricedSeconds: 2_592_000, apr: 1230, riskBps: 500 },
    chain: { bps: 99, fee: 99_000_000n, reason: "" },
    funded: {
      vaultFee: 101_000_000n,
      vaultPayout: 9_899_000_000n,
      idleBefore: 80_000_000_000n,
      idleAfterFund: 70_101_000_000n,
      idleAfterRepay: 80_101_000_000n,
      lockgate: 0n,
    },
    rounding: { nav: 1_000_001n, bps: 99, sim: 9_901n, engineHalfUp: 9_900n, engineCeil: 9_901n, chain: 9_901n },
    fullUtil: { sim: 431, engine: 180, chain: 148 },
  };
  return { ...base, ...patch };
}

test("a funded engine fee that matches the vault is not an integration break", () => {
  const { breaks, divergences } = classify(sheet());
  assert.equal(breaks.length, 0);
  assert.deepEqual(
    divergences.map((item) => item.id),
    ["fee-bps-600s", "fee-rounding", "fee-bps-full-util", "idle-versus-sim"],
  );
  const text = render(sheet(), breaks, divergences);
  assert.match(text, /98 bps, fee 98000000/);
  assert.match(text, /101 bps, fee 101000000/);
  assert.match(text, /99 bps, fee 99000000/);
  const same = sheet();
  same.sim = { ...same.sim, bps: 99 };
  same.engine = { ...same.engine, bps: 99 };
  same.chain = { ...same.chain, bps: 99 };
  assert.equal(classify(same).divergences.some((item) => item.id === "fee-bps-600s"), false);
});

test("a vault that stores a different fee is a break", () => {
  const next = sheet();
  next.funded = { ...next.funded, vaultFee: 99_000_000n };
  const { breaks } = classify(next);
  assert.deepEqual(breaks.map((item) => item.id), ["vault-signed-fee"]);
  assert.match(breaks[0]?.what ?? "", /99000000/);
  assert.match(breaks[0]?.what ?? "", /101000000/);
});
