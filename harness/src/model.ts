/** Stage-1 fee at the PricingEngine constructor curve, utilization below the kink, fresh NAV. */
const YEAR = 31_536_000n;
const BASE_APR = 1_200n;
const TIME_SCALE = 4_320n;
const MIN_FEE = 25n;

export function modelFeeBps(secondsToWindow: bigint): number {
  if (secondsToWindow <= 0n) return Number(MIN_FEE);
  const raw = (BASE_APR * secondsToWindow * TIME_SCALE + YEAR / 2n) / YEAR;
  return Number(raw < MIN_FEE ? MIN_FEE : raw);
}

export function feeFromBps(navValue: bigint, bps: number): bigint {
  const units = BigInt(bps);
  return (navValue * units + 9_999n) / 10_000n;
}
