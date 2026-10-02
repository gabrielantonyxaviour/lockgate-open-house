import { depositEquity, emptyLine, postReserve, type Facility, type Line } from "./books.js";
import type { Mandate } from "./mandate.js";
import { ADVANCE_RATE_BPS, JUNIOR_APR_BPS, JUNIOR_COVENANT_BPS, SENIOR_APR_BPS, u } from "./params.js";
import { makeRng, type Rng } from "./rng.js";
import type { Stage } from "./schema.js";

export type Kind = "weekly" | "epoch" | "quarterly";

export type ExitReq = {
  nav: number;
  fee: number;
  principal: number;
  advanced: boolean;
  dueDay: number;
  open: boolean;
  line: Line | null;
  platform: string;
  feeBps: number;
  misses: number;
  lastMissDay: number;
};

export type Platform = {
  id: string;
  kind: Kind;
  windowDays: number;
  nextWindow: number;
  reserveBps: number;
  limit: number;
  book: number;
  cash: number;
  reserveBudget: number;
  navAgeDays: number;
  refreshPhase: number;
  riskBps: number;
  gateInRun: boolean;
  dead: boolean;
  reqs: ExitReq[];
};

export type PartnerVault = { id: string; mandate: Mandate; line: Line };

export type World = {
  stage: Stage;
  platforms: Platform[];
  lines: Line[];
  vaults: PartnerVault[];
  facility: Facility | null;
  cursor: number;
  techFee: number;
  breaches: number;
  requested: number;
  advanced: number;
  investorPaid: number;
  rejected: Record<string, number>;
  lockgateSwept: number;
  /** Set when a gated early exit is refused. Absent until the first one. */
  gatedHits?: Record<string, number>;
};

export const DAY = 86_400;

export function buildWorld(stage: Stage, seed: number): World {
  const rng = makeRng(seed ^ 0x51ed);
  const platforms: Platform[] = [];
  for (let i = 0; i < 36; i += 1) {
    const kind: Kind = i < 18 ? "weekly" : i < 30 ? "epoch" : "quarterly";
    const windowDays = kind === "weekly" ? 7 : kind === "epoch" ? 30 : 90;
    const reserveBps = [500, 750, 1_000][i % 3]!;
    const limit = u(150_000);
    platforms.push({
      id: `p${String(i).padStart(2, "0")}`,
      kind,
      windowDays,
      nextWindow: 1 + (i % windowDays),
      reserveBps,
      limit,
      book: u(800_000),
      cash: 0,
      reserveBudget: Math.floor((limit * reserveBps) / 10_000),
      navAgeDays: i % 3,
      refreshPhase: i % 3,
      riskBps: [0, 2_500, 5_000][i % 3]!,
      gateInRun: rng.bool(0.25),
      dead: false,
      reqs: [],
    });
  }
  const facility = stage === "stage3" ? newFacility() : null;
  const own = emptyLine();
  if (stage !== "stage2") {
    depositEquity(own, stage === "stage1" ? u(4_000_000) : u(500_000));
    for (const platform of platforms) {
      postReserve(own, platform.id, platform.reserveBudget);
      platform.reserveBudget = 0;
    }
  }
  const vaults = stage === "stage2" ? buildVaults(platforms) : [];
  const lines = stage === "stage2" ? vaults.map((v) => v.line) : [own];
  return {
    stage,
    platforms,
    lines,
    vaults,
    facility,
    cursor: 0,
    techFee: 0,
    breaches: 0,
    requested: 0,
    advanced: 0,
    investorPaid: 0,
    rejected: {},
    lockgateSwept: 0,
  };
}

function newFacility(): Facility {
  const senior = u(1_500_000);
  const junior = u(400_000);
  return {
    seniorCash: senior,
    juniorCash: junior,
    seniorDrawn: 0,
    juniorDrawn: 0,
    seniorDeposited: senior,
    juniorDeposited: junior,
    seniorInterest: 0,
    juniorInterest: 0,
    interestPaid: 0,
    seniorLoss: 0,
    juniorLoss: 0,
    seniorAprBps: SENIOR_APR_BPS,
    juniorAprBps: JUNIOR_APR_BPS,
    advanceRateBps: ADVANCE_RATE_BPS,
    covenantBps: JUNIOR_COVENANT_BPS,
  };
}

function buildVaults(platforms: Platform[]): PartnerVault[] {
  const ids = (pred: (p: Platform) => boolean) => new Set(platforms.filter(pred).map((p) => p.id));
  const specs: Array<[string, Set<string>, number, number, number, number]> = [
    ["Harbour", ids((p) => p.kind === "weekly"), u(80_000), 40, 10 * DAY, 800],
    ["Keppel", ids((p) => p.kind !== "quarterly"), u(100_000), 80, 40 * DAY, 1_200],
    ["Marina", ids(() => true), u(120_000), 120, 120 * DAY, 2_000],
  ];
  return specs.map(([id, approved, limit, minFee, tenor, conc]) => {
    const line = emptyLine();
    depositEquity(line, u(900_000));
    const mandate: Mandate = {
      platforms: approved,
      limit,
      minFeeBps: minFee,
      maxTenorSeconds: tenor,
      concentrationBps: conc,
      expiryDay: 10_000,
      paused: false,
    };
    return { id, mandate, line };
  });
}

export function covenantBroken(facility: Facility | null): boolean {
  if (!facility || facility.juniorDeposited === 0) return false;
  return facility.juniorLoss * 10_000 > facility.juniorDeposited * facility.covenantBps;
}

export function pullFacility(line: Line, facility: Facility): void {
  if (covenantBroken(facility)) return;
  const cap = Math.floor((line.principal * facility.advanceRateBps) / 10_000);
  const drawn = line.seniorDebt + line.juniorDebt;
  let room = Math.max(0, cap - drawn);
  const undrawn = facility.seniorCash + facility.juniorCash;
  room = Math.min(room, undrawn);
  if (room <= 0 || undrawn <= 0) return;
  const seniorPart = Math.floor((room * facility.seniorCash) / undrawn);
  const juniorPart = room - seniorPart;
  facility.seniorCash -= seniorPart;
  facility.juniorCash -= juniorPart;
  facility.seniorDrawn += seniorPart;
  facility.juniorDrawn += juniorPart;
  line.balance += room;
  line.seniorDebt += seniorPart;
  line.juniorDebt += juniorPart;
}

export function accrueAndPay(line: Line, facility: Facility): void {
  facility.seniorInterest += Math.floor((line.seniorDebt * facility.seniorAprBps) / 10_000 / 365);
  facility.juniorInterest += Math.floor((line.juniorDebt * facility.juniorAprBps) / 10_000 / 365);
  let idle = Math.max(0, line.balance - line.reserve);
  const paySenior = Math.min(facility.seniorInterest, idle);
  line.balance -= paySenior;
  line.interestExpense += paySenior;
  facility.seniorInterest -= paySenior;
  facility.interestPaid += paySenior;
  idle -= paySenior;
  const payJunior = Math.min(facility.juniorInterest, idle);
  line.balance -= payJunior;
  line.interestExpense += payJunior;
  facility.juniorInterest -= payJunior;
  facility.interestPaid += payJunior;
}

