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
