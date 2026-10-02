import { getAddress, type Address } from "viem";
import { z } from "zod";
import { ARBITRUM_SEPOLIA, ETHEREUM_SEPOLIA, assertTransactableChain } from "../chains.js";
import { parseOrThrow } from "../domain.js";
import { asApiError, EngineError, type ApiError } from "../errors.js";
import { buildSweepReport } from "../sweep/report.js";
import { planSweep, sweepInputSchema, type SweepAction } from "../sweep/sweep.js";

/**
 * Simulation `MockKeystoneForwarder` rows from the CRE forwarder directory.
 * A deployed workflow uses `KeystoneForwarder`. This harness never selects that contract.
 * https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 */
const SIMULATION_FORWARDER: Record<number, { chainName: string; address: Address }> = {
  [ARBITRUM_SEPOLIA]: {
    chainName: "ethereum-testnet-sepolia-arbitrum-1",
    address: getAddress("0xd41263567ddfead91504199b8c6c87371e83ca5d"),
  },
  [ETHEREUM_SEPOLIA]: {
    chainName: "ethereum-testnet-sepolia",
    address: getAddress("0x15fC6ae953E024d975e77382eEeC56A9101f9F88"),
  },
};

const CRON_FIELD = /^(?:\*(?:\/[1-9]\d*)?|\d+(?:-\d+(?:\/[1-9]\d*)?)?)(?:,(?:\*(?:\/[1-9]\d*)?|\d+(?:-\d+(?:\/[1-9]\d*)?)?))*$/;

export const creSweepInputSchema = sweepInputSchema.extend({
  schedule: z.string().min(1).max(160),
  scheduledExecutionTime: z.number().int().nonnegative().optional(),
}).strict();

export type CreSweepInput = z.infer<typeof creSweepInputSchema>;

export type CreSweepSimulation = {
  workflowName: "lockgate-sweep-local";
  handler: "runCreSweep";
  schedule: string;
  scheduledExecutionTime: number;
  mode: "simulate";
  broadcast: false;
  onReportCalled: false;
  txHash: null;
  forwarder: { contract: "MockKeystoneForwarder" | null; chainName: string | null; address: Address | null };
  chainId: number;
  actions: SweepAction[];
  report: ReturnType<typeof buildSweepReport>;
};

function cronBody(schedule: string): string {
  if (!schedule.startsWith("TZ=")) return schedule.trim();
  const matched = schedule.match(/^TZ=([A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*)\s+(.+)$/);
  if (!matched?.[2]) throw new EngineError("param", "cron timezone prefix is not an IANA name");
  return matched[2].trim();
}

function secondsFired(field: string): number[] {
  const fired = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let second = 0; second < 60; second += 1) fired.add(second);
      continue;
    }
    const stepped = part.match(/^\*\/(\d+)$/);
    const range = part.match(/^(\d+)(?:-(\d+)(?:\/(\d+))?)?$/);
    const start = stepped ? 0 : Number(range?.[1]);
    const end = stepped ? 59 : Number(range?.[2] ?? range?.[1]);
    const step = Number(stepped?.[1] ?? range?.[3] ?? 1);
    if (!range && !stepped) throw new EngineError("param", "cron seconds field is not a schedule");
    if (start > 59 || end > 59 || start > end || step <= 0) {
      throw new EngineError("param", "cron seconds field is not a schedule");
    }
    for (let second = start; second <= end; second += step) fired.add(second);
  }
  return [...fired].sort((left, right) => left - right);
}

/** Chainlink rejects a cron that fires more often than once every 30 seconds. */
export function assertCreSchedule(schedule: string): string {
  const fields = cronBody(schedule).split(/\s+/).filter((field) => field.length > 0);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new EngineError("param", "cron schedule must have 5 or 6 fields");
  }
  if (fields.some((field) => !CRON_FIELD.test(field))) {
    throw new EngineError("param", "cron schedule has a field that is not a number, range, or step");
  }
  if (fields.length === 6) {
    const fired = secondsFired(fields[0] ?? "");
    const gap = fired.length <= 1
      ? 60
      : Math.min(
        ...fired.slice(1).map((second, index) => second - (fired[index] ?? 0)),
        (fired[0] ?? 0) + 60 - (fired[fired.length - 1] ?? 0),
      );
    if (gap < 30) throw new EngineError("param", "cron interval is shorter than 30 seconds");
  }
  return schedule.trim();
}

function simulationForwarder(chainId: number): CreSweepSimulation["forwarder"] {
  const row = SIMULATION_FORWARDER[chainId];
  if (!row) return { contract: null, chainName: null, address: null };
  return { contract: "MockKeystoneForwarder", chainName: row.chainName, address: row.address };
}

/**
 * Local stand-in for a CRE cron that plans a sweep. Simulation records the
 * report and leaves `onReport` uncalled. It does not broadcast.
 */
export function runCreSweep(raw: unknown): CreSweepSimulation {
  const input = parseOrThrow(creSweepInputSchema, raw);
  const schedule = assertCreSchedule(input.schedule);
  assertTransactableChain(input.chainId);
  const actions = planSweep(input);
  return {
    workflowName: "lockgate-sweep-local",
    handler: "runCreSweep",
    schedule,
    scheduledExecutionTime: input.scheduledExecutionTime ?? input.now,
    mode: "simulate",
    broadcast: false,
    onReportCalled: false,
    txHash: null,
    forwarder: simulationForwarder(input.chainId),
    chainId: input.chainId,
    actions,
    report: buildSweepReport(input, actions),
  };
}

/** CRE sweep entry. A bad book, a short cron, or a forbidden chain is `{ error, code }`. */
export function creSweepEntry(raw: unknown): CreSweepSimulation | ApiError {
  try {
    return runCreSweep(raw);
  } catch (err) {
    return asApiError(err);
  }
}
