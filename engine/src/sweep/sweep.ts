import { encodeFunctionData, type Address, type Hex } from "viem";
import { z } from "zod";
import { assertTransactableChain } from "../chains.js";
import { parseOrThrow, zAddress, zAmount } from "../domain.js";
import { EngineError } from "../errors.js";

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
  })),
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

export function classifyAdvance(advance: AdvanceView, now: number, graceSeconds: number): SweepAction {
  const base = { advanceId: advance.id, vault: advance.vault, vaultKind: advance.vaultKind };
  if (advance.status !== "active") {
    return { ...base, kind: "skip", sendable: false, calldata: null, reason: `status ${advance.status}` };
  }
  if (now < advance.dueAt) {
    return { ...base, kind: "pending", sendable: false, calldata: null, reason: "before due" };
  }
  const repayData = encodeFunctionData({ abi: creditLineAbi, functionName: "repay", args: [advance.id] });
  const lateData = encodeFunctionData({ abi: creditLineAbi, functionName: "markLate", args: [advance.id] });
  const partner = advance.vaultKind === "partner";
  if (now >= advance.dueAt + graceSeconds) {
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

export async function broadcastOwnBook(
  actions: SweepAction[],
  chainId: number,
  sender: (tx: { to: Address; data: Hex }) => Promise<Hex>,
): Promise<Hex[]> {
  assertTransactableChain(chainId);
  const hashes: Hex[] = [];
  for (const action of actions) {
    if (!action.sendable || !action.calldata) continue;
    if (action.vaultKind !== "own-book") {
      throw new EngineError("partner-key", "refusing to sign a transaction for a partner vault");
    }
    hashes.push(await sender({ to: action.vault, data: action.calldata }));
  }
  return hashes;
}
