import { lerpBps } from "../money.js";
import type { PricingParams } from "../domain.js";

/** Piecewise-linear APR in bps. Non-decreasing in utilization. */
export function utilizationAprBps(utilizationBps: number, params: PricingParams): number {
  if (utilizationBps <= params.kinkUtilBps) {
    return lerpBps(params.baseAprBps, params.aprAtKinkBps, utilizationBps, params.kinkUtilBps);
  }
  const span = 10_000 - params.kinkUtilBps;
  return lerpBps(
    params.aprAtKinkBps,
    params.aprAtFullBps,
    utilizationBps - params.kinkUtilBps,
    span,
  );
}
