#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isHex, type Hex } from "viem";
import { alertsForQuote } from "./alert/evaluate.js";
import { appendAudit, DEFAULT_AUDIT_PATH } from "./audit/store.js";
import { runBacktest } from "./backtest/harness.js";
import { recordedBacktestBundle, writeBacktestReport } from "./backtest/publish.js";
import { SCENARIOS } from "./backtest/scenarios.js";
import { checkConfig } from "./check/config.js";
import { COMMAND_USAGE, checkCommand, checkFlags, proposeBodySchema, readQuoteRequest, type CheckedFlags, type Command } from "./cli-check.js";
import { describeDryRun, enterDryRun, leaveDryRun } from "./dryrun.js";
import { runCreSweep } from "./cre/sweep.js";
import { runCreTick } from "./cre/tick.js";
import { paramsSchema, parseOrThrow } from "./domain.js";
import { asApiError, EngineError, isApiError } from "./errors.js";
import { exampleBundle } from "./examples.js";
import { assessFacility, facilitySchema } from "./facility/assess.js";
import { encodeJson, parseJson } from "./json.js";
import { logEvent } from "./log.js";
import { DEFAULT_PARAMS } from "./pricing/defaults.js";
import { buildProposal } from "./proposal/build.js";
import { migrateProposeBody } from "./schema/mandate.js";
import { signBuiltProposal } from "./proposal/sign.js";
import { openVaultClient, vaultGuards } from "./proposal/vaultread.js";
import { quoteExit } from "./quote.js";
import { runSweep } from "./sweep/report.js";
import { planSweep } from "./sweep/sweep.js";

type Flags = Record<string, string | boolean>;

const AUDITED = new Set<Command>([
  "quote",
  "score",
  "alerts",
  "propose",
  "sweep",
  "facility",
  "backtest",
  "cre-tick",
  "cre-sweep",
  "check",
]);

export function parseArgs(argv: string[]): { command: string | undefined; flags: Flags } {
  const [command, ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token?.startsWith("--")) throw new EngineError("usage", `unexpected argument ${token}`);
    const key = token.slice(2);
    if (Object.hasOwn(flags, key)) throw new EngineError("usage", `pass --${key} once`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, flags };
}

function readInput(file: string): unknown {
  return parseJson(readFileSync(file, "utf8"));
}

export async function run(argv: string[]): Promise<unknown> {
  const parsed = parseArgs(argv);
  const command = checkCommand(parsed.command);
  const flags = checkFlags(command, parsed.flags);
  const result = await dispatch(command, flags);
  if (AUDITED.has(command)) {
    appendAudit(flags.audit ?? DEFAULT_AUDIT_PATH, command, { dryRun: flags.dryRun, result });
  }
  return result;
}

async function dispatch(command: Command, flags: CheckedFlags): Promise<unknown> {
  if (!flags.dryRun) return execute(command, flags);
  enterDryRun();
  try {
    const quiet = { ...flags, rpc: undefined, signEnv: undefined };
    return describeDryRun(command, await execute(command, quiet));
  } finally {
    leaveDryRun();
  }
}

async function execute(command: Command, flags: CheckedFlags): Promise<unknown> {
  switch (command) {
    case "example":
      return exampleBundle(flags.name);
    case "quote":
      return quoteExit(...quoteArgs(flags.file));
    case "score":
      return quoteExit(...quoteArgs(flags.file)).risk;
    case "alerts": {
      const request = readQuoteRequest(readInput(requireFile(flags.file)));
      return alertsForQuote(request.input, quoteExit(request.input, request.params), request.params);
    }
    case "propose":
      return propose(readInput(requireFile(flags.file)), flags.rpc, flags.signEnv);
    case "sweep":
      if (flags.dryRun) return planSweep(readInput(requireFile(flags.file)));
      return runSweep(readInput(requireFile(flags.file)), flags.report ?? "reports");
    case "facility":
      return assessFacility(parseOrThrow(facilitySchema, readInput(requireFile(flags.file))));
    case "backtest": {
      const params = parseOrThrow(paramsSchema, DEFAULT_PARAMS);
      if (flags.report && !flags.dryRun) writeBacktestReport(flags.report, recordedBacktestBundle(params));
      return runBacktest(SCENARIOS[flags.scenario](), params);
    }
    case "cre-tick":
      return runCreTick(readInput(requireFile(flags.file)));
    case "cre-sweep":
      return runCreSweep(readInput(requireFile(flags.file)));
    case "check":
      return checkConfig(readInput(requireFile(flags.file)));
    default:
      throw new EngineError("usage", COMMAND_USAGE);
  }
}

function requireFile(file: string | undefined): string {
  if (!file) throw new EngineError("usage", "pass --file");
  return file;
}

function quoteArgs(file: string | undefined): [unknown, unknown] {
  const request = readQuoteRequest(readInput(requireFile(file)));
  return [request.input, request.params];
}

async function propose(raw: unknown, rpc: string | undefined, signEnv: string | undefined): Promise<unknown> {
  const body = parseOrThrow(proposeBodySchema, migrateProposeBody(raw));
  const built = buildProposal(body);
  const guards = rpc
    ? await vaultGuards(openVaultClient(rpc), {
      chainId: body.chainId,
      mandate: built.mandate,
      platform: built.message.platform,
      message: built.message,
    })
    : [];
  const blocks = [...built.blocks, ...guards];
  const submittable = blocks.length === 0;
  let signature: Hex | null = null;
  if (submittable && signEnv) {
    const secret = process.env[signEnv];
    if (!secret || !isHex(secret)) throw new EngineError("param", "signing env is missing or not hex");
    signature = await signBuiltProposal(built, secret);
  }
  return {
    submittable,
    blocks,
    digest: built.digest,
    feeBps: built.quote.feeBps,
    fee: built.quote.fee,
    payout: built.quote.payout,
    message: built.message,
    domain: built.domain,
    calldata: built.calldata,
    partner: {
      digest: built.partner.digest,
      submitCalldata: built.partner.submitCalldata,
    },
    signature,
  };
}

/** CLI entry. Failures are `{ error, code? }` and never carry a stack. */
export async function respond(argv: string[]): Promise<unknown> {
  try {
    return await run(argv);
  } catch (err) {
    return asApiError(err);
  }
}

async function main(): Promise<void> {
  const result = await respond(process.argv.slice(2));
  if (isApiError(result)) {
    logEvent("error", "cli", result);
    process.stderr.write(`${encodeJson(result)}\n`);
    process.exitCode = 1;
    return;
  }
  logEvent("info", "cli", { command: process.argv[2] ?? "" });
  process.stdout.write(`${encodeJson(result)}\n`);
}

const entry = process.argv[1] ?? "";
const launchedHere = entry.endsWith("/cli.ts") || entry.endsWith("/cli.js");
// vite-node drops the script path from argv unless --script is set.
const launchedByViteNode = entry.endsWith("/vite-node") && import.meta.url.endsWith("/cli.ts");
if (launchedHere || launchedByViteNode) await main();
