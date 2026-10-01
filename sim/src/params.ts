/**
 * Protocol numbers that are cited, and curve knobs that are assumptions.
 * Assumptions are scenario inputs. They are not market measurements.
 *
 * Cited:
 * - 12% APR (1200 bps) and ~1%/month: lockgate/ideation/DECISIONS.md (28 Sep 2026);
 *   lockgate/SPEC.md PricingEngine baseAprBps 1200.
 * - min 25 bps, max 1500 bps, demo timeScale 4320: lockgate/SPEC.md.
 * - First-loss reserve 5–10%: briefs/grok/PRODUCT.md; 7.5% factory seed: SPEC.md.
 * - Quarterly 5% redemption gate: lockgate/ideation/DECISIONS.md (Apollo-style, 5% a quarter).
 * - Flat technology fee, not per deal: briefs/grok/PRODUCT.md.
 */

export const USDG = 1_000_000n;
export const YEAR_SECONDS = 31_536_000;
export const BASE_APR_BPS = 1200;
export const MIN_FEE_BPS = 25;
export const MAX_FEE_BPS = 1500;
export const DEMO_TIME_SCALE = 4320;

/** Assumption: utilization add-on at 100% utilized. SPEC names the premium, not the slope. */
export const UTIL_PREMIUM_AT_FULL_BPS = 500;
/** Assumption: concentration add-on when one platform is the whole book. */
export const CONC_PREMIUM_AT_FULL_BPS = 300;
/** Assumption: NAV-age add-on at the staleness limit. */
export const AGE_PREMIUM_AT_MAX_BPS = 100;
/** Assumption: draws stop after this NAV age. SPEC leaves maxNavAge owner-set. */
export const MAX_NAV_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Assumption: markLate grace after the missed window. SPEC names grace, not its length. */
export const GRACE_DAYS = 2;

/** Assumption: stage-2 invoice, 2,000 USDG per vault per 30 days. Not taken from vault tokens. */
export const TECH_FEE_USDG_PER_VAULT_PER_30D = 2_000;

/** Assumption: facility coupons and advance rate. Not in the spec. */
export const SENIOR_APR_BPS = 800;
export const JUNIOR_APR_BPS = 1_500;
export const ADVANCE_RATE_BPS = 8_000;
/** Assumption: new borrows stop once junior has absorbed half its deposit. */
export const JUNIOR_COVENANT_BPS = 5_000;

export const u = (whole: number): number => whole * 1_000_000;
