import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLOOR_E8,
  MAX_ORACLE_AGE,
  ORACLE_END,
  ORACLE_START,
  PAR_E8,
  USDC_DEPEG_E8,
  oracleBlock,
  oracleScenario,
  pegFailure,
  renderOracle,
  runOracleBook,
  scaleRepayment,
  type Peg,
} from "../src/oracle.js";
import { scenarioSet } from "../src/scenarios.js";
import { DAY } from "../src/world.js";

const SEED = 20261001;
const DAYS = 360;
const CASH = 10_000_000_000;

function peg(now: number, priceE8: number, age: number, maxOracleAge = MAX_ORACLE_AGE): Peg {
  return { enabled: true, priceE8, updatedAt: now - age, minPriceE8: FLOOR_E8, maxOracleAge };
}

test("a missing or disabled peg is not a depeg", () => {
  const now = 10 * DAY;
  assert.equal(pegFailure(now, undefined), null);
  assert.equal(pegFailure(now, { ...peg(now, 1, 0), enabled: false }), null);
});

test("stale wins over a price under the floor", () => {
  const now = 10 * DAY;
  assert.equal(PAR_E8, 100_000_000);
  assert.equal(FLOOR_E8, 99_000_000);
  assert.equal(USDC_DEPEG_E8, 98_999_999);
  assert.equal(pegFailure(now, peg(now, FLOOR_E8, 0)), null);
  assert.equal(pegFailure(now, peg(now, USDC_DEPEG_E8, 0)), "peg");
  assert.equal(pegFailure(now, peg(now, PAR_E8, MAX_ORACLE_AGE)), null);
  assert.equal(pegFailure(now, peg(now, USDC_DEPEG_E8, MAX_ORACLE_AGE + 1)), "stale-oracle");
  assert.equal(pegFailure(now, peg(now, PAR_E8, 0, 0)), "stale-oracle");
  assert.equal(pegFailure(now, { ...peg(now, PAR_E8, 0), updatedAt: now + 1 }), "stale-oracle");
});

test("USDC depeg scales window cash only inside the window", () => {
  const usdc = oracleScenario("usdc-depeg", DAYS);
  const stale = oracleScenario("stale-price", DAYS);
  const off = scenarioSet(DAYS)[0]!;
  const named = scenarioSet(DAYS).find((row) => row.name === "depeg")!;
  assert.equal(off.oracle, "off");
  assert.equal(named.oracle, "off");
  assert.equal(named.depegFactor, 0.92);
  assert.equal(scaleRepayment(CASH, usdc, ORACLE_START), 9_899_999_900);
  assert.equal(scaleRepayment(CASH, usdc, ORACLE_END), 9_899_999_900);
  assert.equal(Math.floor((CASH * USDC_DEPEG_E8) / PAR_E8), 9_899_999_900);
  assert.equal(scaleRepayment(CASH, usdc, ORACLE_START - 1), CASH);
  assert.equal(scaleRepayment(CASH, usdc, ORACLE_END + 1), CASH);
  assert.equal(scaleRepayment(CASH, stale, ORACLE_START), CASH);
  assert.equal(scaleRepayment(CASH, off, ORACLE_START), CASH);
  assert.equal(scaleRepayment(CASH, named, ORACLE_START), CASH);
});

test("draws stop on the shock edges and the five-scenario set stays closed", () => {
  const usdc = oracleScenario("usdc-depeg", DAYS);
  const stale = oracleScenario("stale-price", DAYS);
  for (const day of [ORACLE_START - 1, ORACLE_END + 1]) {
    assert.equal(oracleBlock(usdc, day), null);
    assert.equal(oracleBlock(stale, day), null);
  }
  for (const day of [ORACLE_START, ORACLE_END]) {
    assert.equal(oracleBlock(usdc, day), "peg");
    assert.equal(oracleBlock(stale, day), "stale-oracle");
  }
  const stressed = oracleScenario("usdc-depeg", DAYS, "default");
  assert.equal(stressed.defaultCount, 4);
  assert.equal(stressed.oracle, "usdc-depeg");
  assert.equal(scenarioSet(DAYS).map((row) => row.name).join(","), "baseline,gating,default,depeg,bank-run");
});

/** id, stage, advances, peg, stale, credit loss, reserve absorbed, reserve posted, coverage bps. */
const BOOK = [
  ["baseline", "stage1", 3500, 0, 0, 0, 0, 405000000000, null],
  ["usdc-depeg", "stage1", 3226, 293, 0, 0, 0, 405000000000, null],
  ["stale-price", "stage1", 3226, 0, 293, 0, 0, 405000000000, null],
  ["default", "stage1", 2958, 0, 0, 168792576900, 37532722500, 405000000000, 2223],
  ["default-usdc-depeg", "stage1", 2729, 293, 0, 168792576900, 37532722500, 405000000000, 2223],
  ["default-stale-price", "stage1", 2729, 0, 293, 168792576900, 37532722500, 405000000000, 2223],
  ["baseline", "stage2", 3490, 0, 0, 0, 0, 330677075000, null],
  ["usdc-depeg", "stage2", 3215, 293, 0, 0, 0, 327905450000, null],
  ["stale-price", "stage2", 3215, 0, 293, 0, 0, 328060650000, null],
  ["default", "stage2", 2948, 0, 0, 168505832000, 10895675000, 310785400000, 646],
  ["default-usdc-depeg", "stage2", 2718, 293, 0, 168505832000, 10895675000, 311022200000, 646],
  ["default-stale-price", "stage2", 2718, 0, 293, 168505832000, 10895675000, 311022200000, 646],
  ["baseline", "stage3", 3497, 0, 0, 0, 0, 405000000000, null],
  ["usdc-depeg", "stage3", 3220, 293, 0, 0, 0, 405000000000, null],
  ["stale-price", "stage3", 3220, 0, 293, 0, 0, 405000000000, null],
  ["default", "stage3", 2957, 0, 0, 168791196300, 37532722500, 405000000000, 2223],
  ["default-usdc-depeg", "stage3", 2727, 293, 0, 168791196300, 37532722500, 405000000000, 2223],
  ["default-stale-price", "stage3", 2727, 0, 293, 168791196300, 37532722500, 405000000000, 2223],
] as const;

const rows = runOracleBook(SEED, DAYS);

test("reserve coverage on seed 20261001", () => {
  assert.equal(rows.length, BOOK.length);
  for (let i = 0; i < BOOK.length; i += 1) {
    const [id, stage, advanced, pegCount, stale, creditLoss, reserveAbsorbed, reservePosted, coverageBps] = BOOK[i]!;
    assert.deepEqual(rows[i], { id, stage, advanced, peg: pegCount, stale, creditLoss, reserveAbsorbed, reservePosted, coverageBps });
    const formula = creditLoss <= 0 ? null : Math.floor((reserveAbsorbed * 10_000) / creditLoss);
    assert.equal(coverageBps, formula);
  }
  for (const stage of ["stage1", "stage2", "stage3"] as const) {
    const family = rows.filter((row) => row.stage === stage && row.id.startsWith("default"));
    assert.equal(new Set(family.map((row) => row.coverageBps)).size, 1);
    assert.equal(new Set(family.map((row) => row.creditLoss)).size, 1);
    assert.equal(new Set(family.map((row) => row.reserveAbsorbed)).size, 1);
    const plain = family.find((row) => row.id === "default")!;
    const shocked = family.find((row) => row.id === "default-usdc-depeg")!;
    assert.ok(shocked.advanced < plain.advanced);
    assert.notEqual(plain.advanced - shocked.advanced, shocked.peg);
  }
  for (const row of rows) {
    if (row.stage === "stage2") continue;
    assert.equal(row.reservePosted, 405_000_000_000);
  }
  const posted = rows.filter((row) => row.stage === "stage2").map((row) => row.reservePosted);
  assert.ok(new Set(posted).size > 1);
});

test("ORACLE.md matches the renderer and the table comes from the rows", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "ORACLE.md");
  const text = renderOracle(rows, SEED, DAYS);
  const changed = renderOracle(
    rows.map((row, index) => (index === 0 ? { ...row, creditLoss: 1, coverageBps: 1 } : row)),
    SEED,
    DAYS,
  );
  assert.notEqual(changed, text);
  assert.match(changed, /\| baseline \| stage1 \| 3500 \| 0 \| 0 \| 1 \| 0 \| 405000000000 \| 1 \|/);
  assert.match(text, /2223/);
  assert.match(text, /646/);
  assert.match(text, /168791196300/);
  assert.equal(readFileSync(path, "utf8"), text);
});
