import { EngineError } from "../errors.js";
import { SECONDS_PER_YEAR } from "../money.js";

/** Accounting mirror of FacilityMath. Interest floors, the same way as OpenZeppelin mulDiv. */
export type FacilityBooks = {
  cash: bigint;
  drawn: bigint;
  seniorPrincipal: bigint;
  juniorPrincipal: bigint;
  seniorDeficit: bigint;
  juniorDeficit: bigint;
  seniorInterestDue: bigint;
  juniorInterestDue: bigint;
  seniorInterestCash: bigint;
  juniorInterestCash: bigint;
  residual: bigint;
  locked: bigint;
  seniorAprBps: bigint;
  juniorAprBps: bigint;
  lastAccrual: number;
  recovery: boolean;
};

export type Waterfall = {
  seniorInterest: bigint;
  seniorPrincipalPay: bigint;
  seniorRestore: bigint;
  juniorInterest: bigint;
  juniorPrincipalPay: bigint;
  juniorRestore: bigint;
  residualAdd: bigint;
};

const BPS = 10_000n;

export function mulDivFloor(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new EngineError("param", "denominator");
  return (amount * numerator) / denominator;
}

function interest(principal: bigint, aprBps: bigint, dt: bigint): bigint {
  return mulDivFloor(mulDivFloor(principal, aprBps, BPS), dt, SECONDS_PER_YEAR);
}

export function solvent(state: FacilityBooks): boolean {
  return state.cash + state.drawn
    === state.seniorPrincipal + state.juniorPrincipal
      + state.seniorInterestCash + state.juniorInterestCash
      + state.residual + state.locked;
}

export function accrue(state: FacilityBooks, now: number): FacilityBooks {
  if (now <= state.lastAccrual) return state;
  const next = { ...state, lastAccrual: now };
  const dt = BigInt(now - state.lastAccrual);
  if (next.recovery || next.drawn === 0n) return next;
  const seniorOut = next.drawn < next.seniorPrincipal ? next.drawn : next.seniorPrincipal;
  const juniorOut = next.drawn - seniorOut;
  if (seniorOut > 0n && next.seniorAprBps > 0n) {
    next.seniorInterestDue += interest(seniorOut, next.seniorAprBps, dt);
  }
  if (juniorOut > 0n && next.juniorAprBps > 0n) {
    next.juniorInterestDue += interest(juniorOut, next.juniorAprBps, dt);
  }
  return next;
}

export function idle(state: FacilityBooks): { senior: bigint; junior: bigint } {
  const seniorOut = state.drawn < state.seniorPrincipal ? state.drawn : state.seniorPrincipal;
  const juniorOut = state.drawn - seniorOut;
  if (juniorOut > state.juniorPrincipal) {
    throw new EngineError("invariant", "drawn principal exceeds senior plus junior");
  }
  return { senior: state.seniorPrincipal - seniorOut, junior: state.juniorPrincipal - juniorOut };
}

export function drawable(state: FacilityBooks): bigint {
  const legs = idle(state);
  return legs.senior + legs.junior;
}

function take(owed: bigint, left: bigint): [bigint, bigint] {
  const paid = left < owed ? left : owed;
  return [paid, left - paid];
}

/** Senior interest, senior principal, senior deficit, then the junior legs, then residual. */
export function onRepay(state: FacilityBooks, amount: bigint): { state: FacilityBooks; split: Waterfall } {
  if (amount < 0n) throw new EngineError("param", "repay amount");
  const next = { ...state, cash: state.cash + amount };
  let left = amount;
  let seniorInterest: bigint;
  [seniorInterest, left] = take(next.seniorInterestDue, left);
  next.seniorInterestDue -= seniorInterest;
  next.seniorInterestCash += seniorInterest;
  const seniorOut = next.drawn < next.seniorPrincipal ? next.drawn : next.seniorPrincipal;
  let seniorPrincipalPay: bigint;
  [seniorPrincipalPay, left] = take(seniorOut, left);
  next.drawn -= seniorPrincipalPay;
  let seniorRestore: bigint;
  [seniorRestore, left] = take(next.seniorDeficit, left);
  next.seniorDeficit -= seniorRestore;
  next.seniorPrincipal += seniorRestore;
  let juniorInterest: bigint;
  [juniorInterest, left] = take(next.juniorInterestDue, left);
  next.juniorInterestDue -= juniorInterest;
  next.juniorInterestCash += juniorInterest;
  let juniorPrincipalPay: bigint;
  [juniorPrincipalPay, left] = take(next.drawn, left);
  next.drawn -= juniorPrincipalPay;
  let juniorRestore: bigint;
  [juniorRestore, left] = take(next.juniorDeficit, left);
  next.juniorDeficit -= juniorRestore;
  next.juniorPrincipal += juniorRestore;
  next.residual += left;
  return {
    state: next,
    split: {
      seniorInterest,
      seniorPrincipalPay,
      seniorRestore,
      juniorInterest,
      juniorPrincipalPay,
      juniorRestore,
      residualAdd: left,
    },
  };
}

export function subordinate(state: FacilityBooks): FacilityBooks {
  if (!state.recovery) return state;
  const seniorOut = state.drawn < state.seniorPrincipal ? state.drawn : state.seniorPrincipal;
  const juniorIdle = idle(state).junior;
  const shift = juniorIdle < seniorOut ? juniorIdle : seniorOut;
  return {
    ...state,
    juniorPrincipal: state.juniorPrincipal - shift,
    juniorDeficit: state.juniorDeficit + shift,
    drawn: state.drawn - shift,
  };
}

export function enterRecovery(state: FacilityBooks): FacilityBooks {
  if (state.recovery) return state;
  return subordinate({ ...state, recovery: true, juniorInterestDue: 0n });
}

export function applyLoss(state: FacilityBooks, loss: bigint): { state: FacilityBooks; applied: bigint } {
  const capped = loss > state.drawn ? state.drawn : loss;
  const juniorTake = capped < state.juniorPrincipal ? capped : state.juniorPrincipal;
  let seniorTake = capped - juniorTake;
  if (seniorTake > state.seniorPrincipal) seniorTake = state.seniorPrincipal;
  const applied = juniorTake + seniorTake;
  return {
    applied,
    state: {
      ...state,
      juniorPrincipal: state.juniorPrincipal - juniorTake,
      juniorDeficit: state.juniorDeficit + juniorTake,
      seniorPrincipal: state.seniorPrincipal - seniorTake,
      seniorDeficit: state.seniorDeficit + seniorTake,
      drawn: state.drawn - applied,
    },
  };
}
