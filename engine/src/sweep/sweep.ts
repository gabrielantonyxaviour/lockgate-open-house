import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { assertTransactableChain } from "../chains.js";
import { blockSendDuringDryRun } from "../dryrun.js";
import { parseOrThrow, zAddress, zAmount } from "../domain.js";
import { EngineError, rethrowPublic } from "../errors.js";

export const sweepInputSchema = z.object({
  chainId: z.number().int().positive(),
  now: z.number().int().nonnegative(),
  graceSeconds: z.number().int().nonnegative(),
  advances: z.array(z.object({
    id: zAmount,
    vault: zAddress,
    platform: zAddress,
    navValue: zAmount,
    dueAt: z.number().int().nonnegative(),
    status: z.enum(["active", "repaid", "late"]),
    cash: z.union([zAmount, z.null()]),
    vaultKind: z.enum(["own-book", "partner"]),
  })).max(64),
});

export const creditLineAbi = [
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "advanceId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "markLate",
    stateMutability: "nonpayable",
    inputs: [{ name: "advanceId", type: "uint256" }],
    outputs: [],
  },
] as const;

export type AdvanceView = {
  id: bigint;
  vault: Address;
  platform: Address;
  navValue: bigint;
  dueAt: number;
  status: "active" | "repaid" | "late";
  cash: bigint | null;
  vaultKind: "own-book" | "partner";
};

export type SweepAction = {
  advanceId: bigint;
  vault: Address;
  vaultKind: AdvanceView["vaultKind"];
  kind: "repay" | "mark-late" | "wait-for-cash" | "pending" | "skip";
  sendable: boolean;
  calldata: Hex | null;
  reason: string;
};

function sweepDeadline(now: number, dueAt: number, graceSeconds: number): number {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(dueAt) || !Number.isSafeInteger(graceSeconds)) {
    throw new EngineError("param", "sweep clock does not fit a safe integer");
  }
  const deadline = dueAt + graceSeconds;
  if (!Number.isSafeInteger(deadline)) throw new EngineError("param", "sweep grace does not fit a safe integer");
  return deadline;
}

export function classifyAdvance(advance: AdvanceView, now: number, graceSeconds: number): SweepAction {
  const base = { advanceId: advance.id, vault: advance.vault, vaultKind: advance.vaultKind };
  const deadline = sweepDeadline(now, advance.dueAt, graceSeconds);
  if (advance.status !== "active") {
    return { ...base, kind: "skip", sendable: false, calldata: null, reason: `status ${advance.status}` };
  }
  if (now < advance.dueAt) {
    return { ...base, kind: "pending", sendable: false, calldata: null, reason: "before due" };
  }
  const repayData = encodeFunctionData({ abi: creditLineAbi, functionName: "repay", args: [advance.id] });
  const lateData = encodeFunctionData({ abi: creditLineAbi, functionName: "markLate", args: [advance.id] });
  const partner = advance.vaultKind === "partner";
  if (now >= deadline) {
    return {
      ...base,
      kind: "mark-late",
      sendable: !partner,
      calldata: lateData,
      reason: partner ? "partner vault: Lockgate will not send markLate" : "past grace",
    };
  }
  if (advance.cash === null) {
    return { ...base, kind: "wait-for-cash", sendable: false, calldata: repayData, reason: "cash unknown" };
  }
  if (advance.cash < advance.navValue) {
    return { ...base, kind: "wait-for-cash", sendable: false, calldata: repayData, reason: "platform cash is short" };
  }
  return {
    ...base,
    kind: "repay",
    sendable: !partner,
    calldata: repayData,
    reason: partner ? "partner vault: Lockgate will not send repay" : "due and funded",
  };
}

export function planSweep(raw: unknown): SweepAction[] {
  const args = parseOrThrow(sweepInputSchema, raw);
  assertTransactableChain(args.chainId);
  return args.advances.map((advance) => classifyAdvance(advance, args.now, args.graceSeconds));
}

let sweeping = false;

function ownBookCalldata(action: SweepAction): Hex | null {
  if (action.kind !== "repay" && action.kind !== "mark-late") return null;
  const name = action.kind === "repay" ? "repay" : "markLate";
  return encodeFunctionData({ abi: creditLineAbi, functionName: name, args: [action.advanceId] });
}

export async function broadcastOwnBook(
  actions: SweepAction[],
  chainId: number,
  creditLine: Address,
  sender: (tx: { to: Address; data: Hex }) => Promise<Hex>,
): Promise<Hex[]> {
  blockSendDuringDryRun("repay or markLate");
  assertTransactableChain(chainId);
  const line = getAddress(creditLine);
  const sendable = actions.filter((action) => action.sendable);
  const ids = sendable.map((action) => action.advanceId.toString());
  if (new Set(ids).size !== ids.length) {
    throw new EngineError("replay", "duplicate advance in one sweep");
  }
  if (sweeping) throw new EngineError("replay", "sweep broadcast is already in progress");
  sweeping = true;
  try {
    const hashes: Hex[] = [];
    for (const action of sendable) {
      if (action.vaultKind !== "own-book") {
        throw new EngineError("partner-key", "refusing to sign a transaction for a partner vault");
      }
      if (getAddress(action.vault) !== line) {
        throw new EngineError("partner-key", "refusing to send outside the own-book credit line");
      }
      const data = ownBookCalldata(action);
      if (!data || action.calldata?.toLowerCase() !== data.toLowerCase()) {
        throw new EngineError("param", "sweep calldata is not repay or markLate for this advance");
      }
      try {
        hashes.push(await sender({ to: line, data }));
      } catch (err) {
        rethrowPublic(err);
      }
    }
    return hashes;
  } finally {
    sweeping = false;
  }
}
