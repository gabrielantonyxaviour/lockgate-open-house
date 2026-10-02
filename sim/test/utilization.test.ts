import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLine, canDraw, depositEquity, draw, emptyLine, exposureBps, postReserve, utilizationBps } from "../src/books.js";
import { u } from "../src/params.js";

const PLATFORM = "p01";
const EQUITY = u(200_000);
const RESERVE = u(10_000);
const PRINCIPAL = u(100_000);
const OWED = u(150_000);
const LIMIT = u(150_000);
const RESERVE_BPS = 500;

test("a line on the owed-nav cap prints utilization below that platform's exposure", () => {
  const idleBook = emptyLine();
  assert.equal(utilizationBps(idleBook), 0);
  assert.equal(exposureBps(idleBook, PLATFORM), 0);

  const line = emptyLine();
  depositEquity(line, EQUITY);
  postReserve(line, PLATFORM, RESERVE);
  const room = canDraw(line, PLATFORM, PRINCIPAL, PRINCIPAL, RESERVE_BPS, LIMIT);
  assert.equal(room.ok, true);
  const atCap = canDraw(line, PLATFORM, PRINCIPAL, OWED, RESERVE_BPS, LIMIT);
  assert.equal(atCap.ok, true);
  const pastCap = canDraw(line, PLATFORM, PRINCIPAL, OWED + 1, RESERVE_BPS, LIMIT);
  assert.equal(pastCap.ok, false);
  if (!pastCap.ok) assert.equal(pastCap.reason, "over-limit");
  assert.ok(PRINCIPAL < LIMIT);

  draw(line, PLATFORM, PRINCIPAL, OWED);
  assertLine(line);
  assert.equal(line.principal, PRINCIPAL);
  assert.equal(line.unearnedFees, OWED - PRINCIPAL);
  assert.equal(line.exposure[PLATFORM], OWED);
  assert.equal(Math.max(0, line.balance - line.reserve), PRINCIPAL);
  assert.ok(line.principal < line.exposure[PLATFORM]!);

  const util = utilizationBps(line);
  const exposure = exposureBps(line, PLATFORM);
  assert.equal(util, 5_000);
  assert.equal(exposure, 10_000);
  assert.ok(util < exposure);

  const more = canDraw(line, PLATFORM, 1, 1, RESERVE_BPS, LIMIT);
  assert.equal(more.ok, false);
  if (!more.ok) assert.equal(more.reason, "over-limit");
  assert.ok(line.principal + 1 < LIMIT);
});
