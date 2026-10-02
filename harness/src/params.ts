/** Demo clock from SPEC.md: timeScale 4320 makes 10 minutes price like 30 days. */
export const DEMO = {
  baseAprBps: 1200,
  timeScale: 4320,
  minFeeBps: 25,
  maxFeeBps: 1500,
  maxNavAge: 7 * 24 * 60 * 60,
  grace: 24 * 60 * 60,
  weeklyInterval: 600,
  epochInterval: 1800,
  quarterlyInterval: 3600,
  nav: 1_023_400n,
  advanceRateBps: 8000,
  seniorAprBps: 800,
  juniorAprBps: 1500,
} as const;

export const SEPOLIA_CLOCK = {
  timeScale: 1,
  weeklyInterval: 7 * 24 * 60 * 60,
  epochInterval: 30 * 24 * 60 * 60,
  quarterlyInterval: 90 * 24 * 60 * 60,
  maxNavAge: 36 * 60 * 60,
  grace: 2 * 24 * 60 * 60,
} as const;

/**
 * Line caps every deploy sets with `setCaps`. Utilization is 80%: outstanding plus the new principal may use at most
 * 80% of capital plus outstanding, so 20% of the line always stays liquid. Concentration stays at 100% because the
 * line measures it as one source's share of total exposure, not of capital: with a single platform drawing, any cap
 * below 100% blocks the first draw. The per-source limit and reserve, both Lockgate-set, bound one platform instead.
 */
export const LINE_CAPS = { utilizationBps: 8000, concentrationBps: 10_000 } as const;
