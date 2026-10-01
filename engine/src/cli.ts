#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isHex, type Hex } from "viem";
import { alertsForQuote } from "./alert/evaluate.js";
import { runBacktest } from "./backtest/harness.js";
import { SCENARIOS } from "./backtest/scenarios.js";
import { runCreTick } from "./cre/tick.js";
import { paramsSchema, parseOrThrow, quoteInputSchema, zAmount } from "./domain.js";
import { EngineError, asApiError } from "./errors.js";
import { exampleBundle } from "./examples.js";
import { encodeJson } from "./json.js";
import { logEvent } from "./log.js";
import { DEFAULT_PARAMS } from "./pricing/defaults.js";
import { buildProposal } from "./proposal/build.js";
import { signBuiltProposal } from "./proposal/sign.js";
import { assessFacility } from "./facility/assess.js";
import { quoteExit } from "./quote.js";
import { planSweep, sweepInputSchema } from "./sweep/sweep.js";
import { z } from "zod";

type Flags = Record<string, string | boolean>;

export function parseArgs(argv: string[]): { command: string | undefined; flags: Flags } {
  const [command, ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token?.startsWith("--")) throw new EngineError("usage", `unexpected argument ${token}`);
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, flags };
}

function readInput(flags: Flags): unknown {
  if (typeof flags.file !== "string") throw new EngineError("usage", "pass --file");
  return JSON.parse(readFileSync(flags.file, "utf8"));
}

const proposeSchema = z.object({
  input: z.unknown(),
  params: z.unknown(),
  mandate: z.unknown(),
  platform: z.string(),
  recipient: z.string(),
  chainId: z.number().int().positive(),
  nonce: zAmount,
});

export async function run(argv: string[]): Promise<unknown> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "example": {
      const name = typeof flags.name === "string" ? flags.name : "epoch";
      return exampleBundle(name);
    }
    case "quote": {
      const body = readInput(flags) as { input?: unknown; params?: unknown };
      const input = body.input ?? body;
      const params = body.params ?? DEFAULT_PARAMS;
      return quoteExit(input, params);
    }
    case "score": {
      const body = readInput(flags) as { input?: unknown; params?: unknown };
      return quoteExit(body.input ?? body, body.params ?? DEFAULT_PARAMS).risk;
    }
    case "alerts": {
      const body = readInput(flags) as { input?: unknown; params?: unknown };
      const params = parseOrThrow(paramsSchema, body.params ?? DEFAULT_PARAMS);
      const rawInput = body.input ?? body;
      const quote = quoteExit(rawInput, params);
      return alertsForQuote(parseOrThrow(quoteInputSchema, rawInput), quote, params);
    }
    case "propose": {
      const body = parseOrThrow(proposeSchema, readInput(flags));
      const built = buildProposal(body);
      let signature: Hex | null = null;
      if (typeof flags["sign-env"] === "string") {
        const secret = process.env[flags["sign-env"]];
        if (!secret || !isHex(secret)) throw new EngineError("param", "signing env is missing or not hex");
        signature = await signBuiltProposal(built, secret);
      }
      return {
        submittable: built.submittable,
        blocks: built.blocks,
        digest: built.digest,
        feeBps: built.quote.feeBps,
        fee: built.quote.fee,
        payout: built.quote.payout,
        message: built.message,
        domain: built.domain,
        calldata: built.calldata,
        partner: {
          digest: built.partner.digest,
          exitRef: built.partner.message.exitRef,
          submitCalldata: built.partner.submitCalldata,
        },
        signature,
      };
    }
    case "sweep":
      return planSweep(parseOrThrow(sweepInputSchema, readInput(flags)));
    case "facility":
      return assessFacility(readInput(flags));
    case "backtest": {
      const name = typeof flags.scenario === "string" ? flags.scenario : "epoch-repay";
      const scenario = SCENARIOS[name as keyof typeof SCENARIOS];
      if (!scenario) throw new EngineError("usage", `unknown scenario ${name}`);
      const params = parseOrThrow(paramsSchema, DEFAULT_PARAMS);
      return runBacktest(scenario(), params);
    }
    case "cre-tick":
      return runCreTick(readInput(flags));
    default:
      throw new EngineError("usage", "commands: example, quote, score, alerts, propose, sweep, facility, backtest, cre-tick");
  }
}

async function main(): Promise<void> {
  try {
    const result = await run(process.argv.slice(2));
    logEvent("info", "cli", { command: process.argv[2] ?? "" });
    process.stdout.write(`${encodeJson(result)}\n`);
  } catch (err) {
    const body = asApiError(err);
    logEvent("error", "cli", body);
    process.stderr.write(`${encodeJson(body)}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ?? "";
const launchedHere = entry.endsWith("/cli.ts") || entry.endsWith("/cli.js");
// vite-node drops the script path from argv unless --script is set.
const launchedByViteNode = entry.endsWith("/vite-node") && import.meta.url.endsWith("/cli.ts");
if (launchedHere || launchedByViteNode) await main();
