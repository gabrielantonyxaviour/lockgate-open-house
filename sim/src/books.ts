import { fail } from "./errors.js";

/**
 * One balance sheet. Stage 1 uses equity only. Stage 2 uses one sheet per
 * partner (equity = that partner's cash). Stage 3 adds senior and junior debt.
 *
 * Identity, checked by residual():
 *   balance + principal + creditLossEquity + interestExpense
 *     = equity + seniorDebt + juniorDebt + reserve + realizedFees
 *
 * `exposure` is unpaid owed nav (principal + fee), matching MandateLogic.
 * `unearnedFees` is the fee portion of that exposure. Losses after the
 * platform reserve: junior claim, then equity, then senior. Equity that
 * has already been paid out as interest is not loss-bearing. Junior undrawn
 * cash is paid into the sheet before equity is touched.
 */
export type Line = {
  balance: number;
  principal: number;
  reserve: number;
  reserves: Record<string, number>;
  exposure: Record<string, number>;
  equity: number;
  seniorDebt: number;
  juniorDebt: number;
  realizedFees: number;
  creditLossEquity: number;
  interestExpense: number;
  reserveAbsorbed: number;
  /** Fee still inside `exposure` and not yet realized. */
  unearnedFees: number;
};

export type Facility = {
  seniorCash: number;
  juniorCash: number;
  seniorDrawn: number;
  juniorDrawn: number;
  seniorDeposited: number;
  juniorDeposited: number;
  seniorInterest: number;
  juniorInterest: number;
  interestPaid: number;
  seniorLoss: number;
  juniorLoss: number;
  seniorAprBps: number;
  juniorAprBps: number;
  advanceRateBps: number;
  covenantBps: number;
};

export function emptyLine(): Line {
  return {
    balance: 0,
    principal: 0,
    reserve: 0,
    reserves: {},
    exposure: {},
    equity: 0,
    seniorDebt: 0,
    juniorDebt: 0,
    realizedFees: 0,
    creditLossEquity: 0,
    interestExpense: 0,
    reserveAbsorbed: 0,
    unearnedFees: 0,
  };
}

export function residual(line: Line): number {
  const lhs = line.balance + line.principal + line.creditLossEquity + line.interestExpense;
  const rhs = line.equity + line.seniorDebt + line.juniorDebt + line.reserve + line.realizedFees;
  return lhs - rhs;
}

function intact(n: number, label: string): void {
  if (!Number.isSafeInteger(n) || n < 0) fail(`${label} is not a safe non-negative integer`, "accounting");
}

export function depositEquity(line: Line, amount: number): void {
  intact(amount, "deposit");
  line.balance += amount;
  line.equity += amount;
}

export function postReserve(line: Line, platform: string, amount: number): void {
  intact(amount, "reserve");
  line.balance += amount;
  line.reserve += amount;
  line.reserves[platform] = (line.reserves[platform] ?? 0) + amount;
}

export function withdrawable(line: Line): number {
  const debt = line.seniorDebt + line.juniorDebt;
  const cushion = Math.max(0, debt - line.principal);
  return Math.max(0, line.balance - line.reserve - cushion);
}

export function withdrawEquity(line: Line, amount: number): void {
  if (amount > withdrawable(line)) fail("withdraw exceeds idle equity", "withdraw");
  line.balance -= amount;
  line.equity -= amount;
}

export function utilizationBps(line: Line): number {
  const idle = Math.max(0, line.balance - line.reserve);
  const denom = line.principal + idle;
  if (denom <= 0) return 0;
  return Math.floor((line.principal * 10_000) / denom);
}

export function exposureBps(line: Line, platform: string): number {
  const book = line.principal + line.unearnedFees;
  if (book <= 0) return 0;
  const share = Math.floor(((line.exposure[platform] ?? 0) * 10_000) / book);
  return share > 10_000 ? 10_000 : share;
}

/** Ceiling reserve, matching MandateLogic `Rounding.Ceil` on owed nav. */
export function reserveNeed(owed: number, reserveBps: number): number {
  if (owed <= 0 || reserveBps <= 0) return 0;
  return Math.floor((owed * reserveBps + 9_999) / 10_000);
}

export type DrawCheck =
  | { ok: true }
  | { ok: false; reason: string };

export function canDraw(
  line: Line,
  platform: string,
  principal: number,
  owed: number,
  reserveBps: number,
  limit: number,
): DrawCheck {
  if (principal <= 0 || owed < principal) return { ok: false, reason: "dust" };
  const exposure = (line.exposure[platform] ?? 0) + owed;
  if (owed > limit || exposure > limit) return { ok: false, reason: "over-limit" };
  if ((line.reserves[platform] ?? 0) < reserveNeed(exposure, reserveBps)) {
    return { ok: false, reason: "reserve-short" };
  }
  if (line.balance - line.reserve < principal) return { ok: false, reason: "capital-short" };
  return { ok: true };
}

export function draw(line: Line, platform: string, principal: number, owed = principal): void {
  if (owed < principal || line.balance - line.reserve < principal) fail("draw broke reserve cash", "solvency");
  line.balance -= principal;
  line.principal += principal;
  line.exposure[platform] = (line.exposure[platform] ?? 0) + owed;
  line.unearnedFees += owed - principal;
}

export function repay(line: Line, platform: string, principal: number, fee: number): void {
  const owed = principal + fee;
  const exposure = line.exposure[platform] ?? 0;
  if (principal > line.principal || owed > exposure || fee > line.unearnedFees) fail("repay above exposure", "repay");
  line.balance += owed;
  line.principal -= principal;
  line.exposure[platform] = exposure - owed;
  line.unearnedFees -= fee;
  line.realizedFees += fee;
}

export type LossSplit = {
  reserve: number;
  juniorCash: number;
  juniorDebt: number;
  equity: number;
  senior: number;
};

/**
 * Write off `principal` of one platform. That platform's reserve is used first.
 * Then junior undrawn cash (paid into the sheet), junior drawn claim, equity, senior.
 */
export function absorbLoss(
  line: Line,
  facility: Facility | null,
  platform: string,
  principal: number,
  owed = principal,
): LossSplit {
  const exposure = line.exposure[platform] ?? 0;
  const forgiven = owed - principal;
  if (owed < principal || principal > line.principal || owed > exposure || forgiven > line.unearnedFees) {
    fail("writeoff above exposure", "loss");
  }
  const reserveHave = line.reserves[platform] ?? 0;
  const reserve = Math.min(principal, reserveHave);
  let hole = principal - reserve;
  line.reserves[platform] = reserveHave - reserve;
  line.reserve -= reserve;
  line.reserveAbsorbed += reserve;

  let juniorCash = 0;
  if (facility && hole > 0 && facility.juniorCash > 0) {
    juniorCash = Math.min(hole, facility.juniorCash);
    facility.juniorCash -= juniorCash;
    facility.juniorLoss += juniorCash;
    line.balance += juniorCash;
    hole -= juniorCash;
  }

  let juniorDebt = 0;
  if (hole > 0 && line.juniorDebt > 0) {
    juniorDebt = Math.min(hole, line.juniorDebt);
    line.juniorDebt -= juniorDebt;
    if (facility) {
      facility.juniorDrawn -= juniorDebt;
      facility.juniorLoss += juniorDebt;
    }
    hole -= juniorDebt;
  }

  const equityRoom = line.equity + line.realizedFees - line.creditLossEquity - line.interestExpense;
  let equity = Math.min(hole, Math.max(0, equityRoom));
  line.creditLossEquity += equity;
  hole -= equity;

  let senior = hole;
  if (senior > line.seniorDebt) {
    // Book is insolvent past every tranche. The remainder stays on equity
    // so the identity still closes and equity value goes negative.
    line.creditLossEquity += senior - line.seniorDebt;
    equity += senior - line.seniorDebt;
    senior = line.seniorDebt;
  }
  line.seniorDebt -= senior;
  if (facility && senior > 0) {
    facility.seniorDrawn -= senior;
    facility.seniorLoss += senior;
  }

  line.principal -= principal;
  line.exposure[platform] = exposure - owed;
  line.unearnedFees -= forgiven;
  return { reserve, juniorCash, juniorDebt, equity, senior };
}

export function equityValue(line: Line): number {
  return line.balance + line.principal - line.seniorDebt - line.juniorDebt - line.reserve;
}

export function sumValues(map: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(map)) n += v;
  return n;
}

export function assertLine(line: Line): void {
  if (residual(line) !== 0) fail(`identity residual ${residual(line)}`, "solvency");
  if (line.balance < line.reserve) fail("reserve cash was lent out", "solvency");
  if (sumValues(line.reserves) !== line.reserve) fail("reserve map drifted", "solvency");
  if (sumValues(line.exposure) !== line.principal + line.unearnedFees) fail("exposure drifted", "solvency");
  if (line.seniorDebt > 0 && line.juniorDebt === 0 && line.creditLossEquity > 0) {
    // Senior may still be outstanding after equity has taken a loss. That is
    // the intended order. Junior must already be at zero. Checked by caller
    // together with facility cash.
  }
}
