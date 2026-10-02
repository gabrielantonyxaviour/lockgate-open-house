import { z } from "zod";
import { SCENARIOS } from "./backtest/scenarios.js";
import {
  mandateSchema,
  paramsSchema,
  parseOrThrow,
  quoteInputSchema,
  zAddress,
  zAmount,
  type PricingParams,
  type QuoteInput,
} from "./domain.js";
import { EngineError } from "./errors.js";
import { DEFAULT_PARAMS } from "./pricing/defaults.js";

export const COMMANDS = [
  "example",
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
] as const;

export type Command = (typeof COMMANDS)[number];

export const COMMAND_USAGE = `commands: ${COMMANDS.join(", ")}`;

const FILE_COMMANDS = new Set<Command>(["quote", "score", "alerts", "propose", "sweep", "facility", "cre-tick", "cre-sweep", "check"]);

const ALLOWED_FLAGS: Record<Command, readonly string[]> = {
  example: ["name", "audit"],
  quote: ["file", "audit"],
  score: ["file", "audit"],
  alerts: ["file", "audit"],
  propose: ["file", "rpc", "sign-env", "audit"],
  sweep: ["file", "report", "audit"],
  facility: ["file", "audit"],
  backtest: ["scenario", "report", "audit"],
  "cre-tick": ["file", "audit"],
  "cre-sweep": ["file", "audit"],
  check: ["file", "audit"],
};

const EXAMPLES = ["weekly", "epoch", "quarterly", "fifo", "demo"] as const;
const SCENARIO_NAMES = Object.keys(SCENARIOS) as [keyof typeof SCENARIOS, ...(keyof typeof SCENARIOS)[]];

const SWITCHES = new Set(["dry-run"]);

export type CheckedFlags = {
  file?: string;
  name: (typeof EXAMPLES)[number];
  scenario: keyof typeof SCENARIOS;
  rpc?: string;
  signEnv?: string;
  report?: string;
  audit?: string;
  dryRun: boolean;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function checkCommand(command: string | undefined): Command {
  const parsed = z.enum(COMMANDS).safeParse(command);
  if (!parsed.success) {
    throw new EngineError("usage", COMMAND_USAGE);
  }
  return parsed.data;
}

export function checkFlags(command: Command, flags: Record<string, string | boolean>): CheckedFlags {
  for (const [key, value] of Object.entries(flags)) {
    if (SWITCHES.has(key)) {
      if (value !== true) throw new EngineError("usage", "pass --dry-run without a value");
      continue;
    }
    if (!ALLOWED_FLAGS[command].includes(key)) throw new EngineError("usage", `unexpected flag --${key}`);
    if (typeof value !== "string") throw new EngineError("usage", `pass --${key} with a value`);
  }
  const file = typeof flags.file === "string"
    ? parseOrThrow(z.string().min(1).max(400), flags.file, "usage")
    : undefined;
  if (FILE_COMMANDS.has(command) && !file) throw new EngineError("usage", "pass --file");
  return {
    file,
    name: parseOrThrow(z.enum(EXAMPLES), flags.name ?? "epoch", "usage"),
    scenario: parseOrThrow(z.enum(SCENARIO_NAMES), flags.scenario ?? "epoch-repay", "usage"),
    rpc: typeof flags.rpc === "string"
      ? parseOrThrow(
        z.string().max(200).refine(isHttpUrl, { message: "rpc must be an http(s) URL" }),
        flags.rpc,
        "param",
      )
      : undefined,
    signEnv: typeof flags["sign-env"] === "string"
      ? parseOrThrow(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,80}$/, { message: "sign-env must name an environment variable" }),
        flags["sign-env"],
        "param",
      )
      : undefined,
    report: typeof flags.report === "string"
      ? parseOrThrow(z.string().min(1).max(200).regex(/^[^\0\r\n]+$/), flags.report, "param")
      : undefined,
    audit: typeof flags.audit === "string"
      ? parseOrThrow(z.string().min(1).max(400).regex(/^[^\0\r\n]+$/), flags.audit, "param")
      : undefined,
    dryRun: flags["dry-run"] === true,
  };
}

const quoteFileSchema = z.object({
  input: quoteInputSchema,
  params: paramsSchema.optional(),
}).strict();

export function readQuoteRequest(raw: unknown): { input: QuoteInput; params: PricingParams } {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && ("input" in raw || "params" in raw)) {
    const body = parseOrThrow(quoteFileSchema, raw);
    return { input: body.input, params: body.params ?? DEFAULT_PARAMS };
  }
  return { input: parseOrThrow(quoteInputSchema, raw), params: DEFAULT_PARAMS };
}

export const proposeBodySchema = z.object({
  input: quoteInputSchema,
  params: paramsSchema,
  mandate: mandateSchema,
  platform: zAddress,
  recipient: zAddress,
  chainId: z.number().int().positive(),
  nonce: zAmount,
}).strict();
