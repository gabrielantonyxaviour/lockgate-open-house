import { z } from "zod";
import { parseOrThrow, type QuoteInput } from "../domain.js";

/**
 * Fixture decoders for redemption shapes in research/grok/G4-exit-mechanics.md.
 * Kasu, Maple, and sUSDai already read the weekly, open-FIFO, and epoch shapes.
 * These stubs do not dial an RPC and are not CRE reads.
 */
export const LIVE_READERS = ["kasu", "maple", "usdai"] as const;

export type CategoryClock = {
  input: QuoteInput;
  notes: string[];
  clock: boolean;
};

const DAY = 86_400;
const OFFER_NOTICE = 1_790_812_800;
const REQUEST_DEADLINE = 1_793_318_400;

const gatedSchema = z.object({
  category: z.literal("quarterly-gated-repurchase"),
  platform: z.enum(["acred", "fullerton", "flow", "tradeflow"]),
  offerBps: z.number().int().min(0).max(10_000).nullable(),
  capBps: z.number().int().min(0).max(10_000).nullable(),
  epochStart: z.number().int().nonnegative().optional(),
  deadline: z.number().int().positive().optional(),
});

const cycleSchema = z.object({
  category: z.literal("two-cycle-vault"),
  platform: z.enum(["fasanara", "falconx", "bastion", "adaptive", "rockaway", "abraxas"]),
  cycleDays: z.number().int().positive().optional(),
  bufferHours: z.number().int().nonnegative().optional(),
  earlyExit: z.boolean(),
});

const bufferSchema = z.object({
  category: z.literal("buffer-or-window"),
  token: z.enum(["reUSD", "reUSDe"]),
  mode: z.enum(["buffer", "window"]),
  bufferAboveFloor: z.boolean().optional(),
});

const cohortSchema = z.object({
  category: z.literal("calendar-cohort"),
  platform: z.literal("gaib-said"),
});

const lockSchema = z.object({
  category: z.literal("lock-then-cooldown"),
  platform: z.literal("jane-susd3"),
  lockLabel: z.literal("1-month"),
  cooldownSeconds: z.null(),
  windowSeconds: z.null(),
});

const cappedSchema = z.object({
  category: z.literal("capped-fifo"),
  platform: z.literal("openeden-hybond"),
  capBps: z.literal(1_000),
  settlement: z.literal("T+4"),
  queueAmount: z.null(),
});

export type GatedRepurchase = z.infer<typeof gatedSchema>;
export type TwoCycleVault = z.infer<typeof cycleSchema>;
export type BufferOrWindow = z.infer<typeof bufferSchema>;
export type CalendarCohort = z.infer<typeof cohortSchema>;
export type LockCooldown = z.infer<typeof lockSchema>;
export type CappedFifo = z.infer<typeof cappedSchema>;

function hold(input: QuoteInput, notes: string[]): CategoryClock {
  return { input, notes, clock: false };
}

/** ACRED's printed notice and request deadline. Other quarterly pages do not give that pair. */
export function applyGatedRepurchase(input: QuoteInput, raw: unknown): CategoryClock {
  const read = parseOrThrow(gatedSchema, raw);
  const notes = ["no-queue-amount"];
  if (read.offerBps !== null && read.capBps !== null) notes.push("offer-and-cap-differ");
  else if (read.offerBps !== null) notes.push("minimum-offer");
  else if (read.capBps !== null) notes.push("cap-printed");
  else notes.push("gate-unprinted");
  if (read.platform === "tradeflow") notes.push("ninety-day-unlabeled");
  if (read.epochStart === undefined || read.deadline === undefined || read.deadline <= read.epochStart) {
    return hold(input, [...notes, "clock-unprinted"]);
  }
  return {
    input: {
      ...input,
      kind: "quarterly-gated",
      epochStart: read.epochStart,
      windowSeconds: read.deadline - read.epochStart,
      cashKnown: false,
    },
    notes: [...notes, "request-deadline", "underlying-deadline-not-due"],
    clock: true,
  };
}

/** One printed cycle length. The claim cycle and the buffer stay out of the quote clock. */
export function applyTwoCycle(input: QuoteInput, raw: unknown): CategoryClock {
  const read = parseOrThrow(cycleSchema, raw);
  const notes = ["no-queue-amount", "claim-next-cycle"];
  if (read.bufferHours !== undefined) notes.push(`buffer-${read.bufferHours}h`);
  if (read.earlyExit) notes.push("early-exit");
  if (read.cycleDays === undefined) return hold(input, [...notes, "cycle-not-in-seconds"]);
  notes.push(`cycle-${read.cycleDays}d`);
  if (input.epochStart === undefined) return hold(input, [...notes, "epoch-start-unprinted"]);
  return {
    input: {
      ...input,
      kind: "epoch",
      epochSeconds: read.cycleDays * DAY,
      cashKnown: false,
    },
    notes,
    clock: true,
  };
}

/** Re prints an instant buffer and a quarterly window, and does not print the next window date. */
export function applyBufferOrWindow(input: QuoteInput, raw: unknown): CategoryClock {
  const read = parseOrThrow(bufferSchema, raw);
  if (read.mode === "buffer" && read.bufferAboveFloor === true) {
    return hold(input, ["instant-buffer"]);
  }
  const notes = ["window-date-unprinted"];
  if (read.token === "reUSDe") notes.push("pro-rata-returned");
  return hold(input, notes);
}

/** The how-to page and the sAID page do not name the same settlement date. */
export function applyCalendarCohort(input: QuoteInput, raw: unknown): CategoryClock {
  parseOrThrow(cohortSchema, raw);
  return hold(input, ["how-to-next-month", "said-month-after-next"]);
}

/** The lock is named. The cooldown and the withdrawal window are not. */
export function applyLockCooldown(input: QuoteInput, raw: unknown): CategoryClock {
  parseOrThrow(lockSchema, raw);
  return hold(input, ["cooldown-unprinted", "window-unprinted"]);
}

/** FIFO, a 10% NAV cap, and T+4 business days. No queue amount, so this is not Maple's 30-day clock. */
export function applyCappedFifo(input: QuoteInput, raw: unknown): CategoryClock {
  const read = parseOrThrow(cappedSchema, raw);
  return hold(input, [`cap-${read.capBps}-bps`, "t-plus-4-business-days", "no-queue-amount"]);
}

export const CATEGORY_STUBS = [
  { category: "quarterly-gated-repurchase", apply: applyGatedRepurchase, live: false },
  { category: "two-cycle-vault", apply: applyTwoCycle, live: false },
  { category: "buffer-or-window", apply: applyBufferOrWindow, live: false },
  { category: "calendar-cohort", apply: applyCalendarCohort, live: false },
  { category: "lock-then-cooldown", apply: applyLockCooldown, live: false },
  { category: "capped-fifo", apply: applyCappedFifo, live: false },
] as const;

export { OFFER_NOTICE, REQUEST_DEADLINE };
