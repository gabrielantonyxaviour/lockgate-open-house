import { z } from "zod";
import { parseOrThrow, pegSchema, zAmount } from "../domain.js";
import { pegFailure } from "../pricing/peg.js";
import {
  accrue,
  drawable,
  idle,
  mulDivFloor,
  solvent,
  type FacilityBooks,
} from "./math.js";

const BPS = 10_000n;

export const facilitySchema = z.object({
  now: z.number().int().nonnegative(),
  cash: zAmount,
  drawn: zAmount,
  seniorPrincipal: zAmount,
  juniorPrincipal: zAmount,
  seniorDeficit: zAmount.optional(),
  juniorDeficit: zAmount.optional(),
  seniorInterestDue: zAmount.optional(),
  juniorInterestDue: zAmount.optional(),
  seniorInterestCash: zAmount.optional(),
  juniorInterestCash: zAmount.optional(),
  residual: zAmount.optional(),
  locked: zAmount.optional(),
  seniorAprBps: z.number().int().min(0).max(10_000),
  juniorAprBps: z.number().int().min(0).max(10_000),
  advanceRateBps: z.number().int().min(0).max(10_000),
  maxLateBps: z.number().int().min(0).max(10_000),
  minJuniorBps: z.number().int().min(0).max(10_000),
  lastAccrual: z.number().int().nonnegative(),
  recovery: z.boolean(),
  eligibleOutstanding: zAmount,
  lateOutstanding: zAmount,
  bookReadable: z.boolean(),
  peg: pegSchema.optional(),
  payout: zAmount.optional(),
});

export type FacilityAssessment = {
  solvent: boolean;
  borrowingBase: bigint;
  availableDraw: bigint;
  drawable: bigint;
  breached: boolean;
  reasons: string[];
  canFund: boolean;
  books: FacilityBooks;
};

function booksFrom(row: z.infer<typeof facilitySchema>): FacilityBooks {
  return {
    cash: row.cash,
    drawn: row.drawn,
    seniorPrincipal: row.seniorPrincipal,
    juniorPrincipal: row.juniorPrincipal,
    seniorDeficit: row.seniorDeficit ?? 0n,
    juniorDeficit: row.juniorDeficit ?? 0n,
    seniorInterestDue: row.seniorInterestDue ?? 0n,
    juniorInterestDue: row.juniorInterestDue ?? 0n,
    seniorInterestCash: row.seniorInterestCash ?? 0n,
    juniorInterestCash: row.juniorInterestCash ?? 0n,
    residual: row.residual ?? 0n,
    locked: row.locked ?? 0n,
    seniorAprBps: BigInt(row.seniorAprBps),
    juniorAprBps: BigInt(row.juniorAprBps),
    lastAccrual: row.lastAccrual,
    recovery: row.recovery,
  };
}

export function breachReasons(row: z.infer<typeof facilitySchema>, books: FacilityBooks): string[] {
  const reasons: string[] = [];
  if (!row.bookReadable) reasons.push("book-unreadable");
  const peg = pegFailure(row.now, row.peg);
  if (peg) reasons.push(peg);
  if (!row.bookReadable) return reasons;
  const eligible = row.eligibleOutstanding;
  const late = row.lateOutstanding;
  const total = eligible + late;
  if (total > 0n && late > mulDivFloor(total, BigInt(row.maxLateBps), BPS)) reasons.push("late-ratio");
  if (books.drawn > mulDivFloor(eligible, BigInt(row.advanceRateBps), BPS)) reasons.push("advance-rate");
  const capital = books.seniorPrincipal + books.juniorPrincipal;
  if (capital > 0n && books.juniorPrincipal < mulDivFloor(capital, BigInt(row.minJuniorBps), BPS)) {
    reasons.push("junior-thin");
  }
  return reasons;
}

/** Stage 3 capacity. Pure. Drawing stays on the facility contract. */
export function assessFacility(raw: unknown): FacilityAssessment {
  const row = parseOrThrow(facilitySchema, raw);
  const books = accrue(booksFrom(row), row.now);
  idle(books);
  const reasons = breachReasons(row, books);
  const breached = row.recovery || reasons.length > 0;
  const base = row.bookReadable ? mulDivFloor(row.eligibleOutstanding, BigInt(row.advanceRateBps), BPS) : 0n;
  const liquid = drawable(books);
  const room = books.drawn >= base ? 0n : base - books.drawn;
  const availableDraw = breached ? 0n : (room < liquid ? room : liquid);
  const payout = row.payout;
  return {
    solvent: solvent(books),
    borrowingBase: base,
    availableDraw,
    drawable: liquid,
    breached,
    reasons,
    canFund: payout !== undefined && payout > 0n && payout <= availableDraw,
    books,
  };
}
