import assert from "node:assert/strict";
import { test } from "node:test";
import { TECH_FEE_USDG_PER_VAULT_PER_30D, u } from "../src/params.js";
import { scenarioSet } from "../src/scenarios.js";
import { runOnce } from "../src/simulate.js";
import { buildWorld } from "../src/world.js";

test("each stage books at least 30 platforms and the reserve band is 5 to 10 percent", () => {
  for (const stage of ["stage1", "stage2", "stage3"] as const) {
    const world = buildWorld(stage, 20261001);
    assert.ok(world.platforms.length >= 30, stage);
    assert.equal(world.platforms.length, 36);
    let posted = 0;
    for (const platform of world.platforms) {
      assert.ok(platform.reserveBps >= 500 && platform.reserveBps <= 1_000, platform.id);
      posted += Math.floor((platform.limit * platform.reserveBps) / 10_000);
    }
    if (stage === "stage2") {
      assert.equal(world.lines.reduce((n, line) => n + line.reserve, 0), 0);
      assert.equal(world.platforms.reduce((n, platform) => n + platform.reserveBudget, 0), posted);
    } else {
      assert.equal(world.lines[0]!.reserve, posted);
      assert.ok(world.platforms.every((platform) => platform.reserveBudget === 0));
    }
  }
});

test("stage 1 is one own book, stage 2 is one vault per partner, stage 3 adds a facility", () => {
  const stage1 = buildWorld("stage1", 20261001);
  assert.equal(stage1.lines.length, 1);
  assert.equal(stage1.vaults.length, 0);
  assert.equal(stage1.facility, null);
  assert.equal(stage1.lines[0]!.equity, u(4_000_000));

  const stage2 = buildWorld("stage2", 20261001);
  assert.equal(stage2.vaults.length, 3);
  assert.equal(stage2.lines.length, 3);
  assert.equal(stage2.facility, null);
  assert.deepEqual(stage2.vaults.map((vault) => vault.id), ["Harbour", "Keppel", "Marina"]);
  for (const vault of stage2.vaults) assert.equal(vault.line.equity, u(900_000));

  const stage3 = buildWorld("stage3", 20261001);
  assert.equal(stage3.lines.length, 1);
  assert.equal(stage3.vaults.length, 0);
  assert.equal(stage3.lines[0]!.equity, u(500_000));
  assert.ok(stage3.facility);
  assert.equal(stage3.facility.seniorDeposited, u(1_500_000));
  assert.equal(stage3.facility.juniorDeposited, u(400_000));
  assert.equal(stage3.lines[0]!.seniorDebt, 0);
});

test("the stage-2 technology fee is flat and is not swept from a vault", () => {
  const scenario = scenarioSet(60)[0]!;
  const partner = runOnce("stage2", scenario, 20261001, false);
  const invoices = 2;
  assert.equal(partner.techFee, 3 * u(TECH_FEE_USDG_PER_VAULT_PER_30D) * invoices);
  assert.equal(partner.lockgateSwept, 0);
  assert.equal(partner.breaches, 0);
  assert.equal(runOnce("stage1", scenario, 20261001, false).techFee, 0);
  assert.equal(runOnce("stage3", scenario, 20261001, false).techFee, 0);
});
