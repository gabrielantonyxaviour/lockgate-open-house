/**
 * Numbers that are product decisions, not fitted market data.
 * Citations and the [design] marks live in MODEL.md.
 * The curve knobs equal the `PricingEngine` constructor (contracts/src/core/PricingEngine.sol), which is the
 * source of truth: same APR kink, same concentration premium (none), same year. Only `timeScale` differs, since the
 * chain ships the demo scale; pass DEMO_TIME_SCALE to price the demo clock.
 */
export const DEFAULT_PARAMS = {
  baseAprBps: 1200,
  kinkUtilBps: 6667,
  aprAtKinkBps: 1200,
  aprAtFullBps: 1800,
  minFeeBps: 25,
  maxFeeBps: 1500,
  timeScale: 1,
  maxRiskPremiumAprBps: 600,
  navWarnSeconds: 86_400,
  maxNavAgeSeconds: 7 * 86_400,
  navAgeMaxPremiumAprBps: 300,
  concentrationCapBps: 10_000,
  concentrationMaxPremiumAprBps: 0,
  maxTenorSeconds: 366 * 86_400,
  proposalTtlSeconds: 600,
  graceSeconds: 86_400,
  minSamples: 3,
  unknownHistoryBps: 5000,
  unknownGateBps: 2000,
  unknownLiquidityQueueBps: 8000,
} as const;

export const DEMO_TIME_SCALE = 4320;

export const RISK_WEIGHTS = {
  repayment: 3500,
  queue: 2500,
  gating: 1500,
  nav: 1500,
  concentration: 1000,
} as const;

export const QUEUE = {
  kasuEpochSeconds: 604_800,
  kasuClearingSeconds: 172_800,
  kasuPriorityEpochs: 5,
  epochSeconds: 2_592_000,
  epochCutoffSeconds: 86_400,
  quarterlySeconds: 7_776_000,
  mapleCoveredWaitSeconds: 86_400,
  mapleWorstCaseSeconds: 2_592_000,
  maxRollovers: 36,
} as const;
