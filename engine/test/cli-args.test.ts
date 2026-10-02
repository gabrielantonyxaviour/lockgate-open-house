import { describe, expect, it } from "vitest";
import { respond } from "../src/cli.js";
import { isApiError } from "../src/errors.js";

const COMMANDS = "commands: example, quote, score, alerts, propose, sweep, facility, backtest, cre-tick, cre-sweep, check";
const NAMES = 'input: Invalid option: expected one of "weekly"|"epoch"|"quarterly"|"fifo"|"demo"';
const SCENARIOS = 'input: Invalid option: expected one of "kasu-repay-slash"|"epoch-repay"|"gated-refuse"|"stale-refuse"|"busy-book"|"reserve-short"';
const PATTERN = "input: Invalid string: must match pattern /^[^\\0\\r\\n]+$/";
const QUOTE = "fixtures/sepolia/quote.json";
const PROPOSE = "fixtures/sepolia/propose.json";
const SWEEP = "fixtures/sepolia/sweep.json";

type Row = { argv: string[]; code: string; error: string };

async function expectRows(rows: Row[]): Promise<void> {
  for (const row of rows) {
    const got = await respond(row.argv);
    expect(got, row.argv.join(" ")).toEqual({ error: row.error, code: row.code });
    expect(JSON.stringify(got)).not.toMatch(/stack|\.ts:|\r|\n/);
  }
}

describe("cli argument parsing", () => {
  it("returns usage when a command or a required flag is missing", async () => {
    const fileCommands = ["quote", "score", "alerts", "propose", "sweep", "facility", "cre-tick", "cre-sweep", "check"];
    await expectRows([
      { argv: [], code: "usage", error: COMMANDS },
      { argv: [""], code: "usage", error: COMMANDS },
      ...fileCommands.map((command) => ({ argv: [command], code: "usage", error: "pass --file" })),
      { argv: ["quote", "--dry-run"], code: "usage", error: "pass --file" },
      { argv: ["quote", "--file"], code: "usage", error: "pass --file with a value" },
      { argv: ["quote", "--file", "--dry-run"], code: "usage", error: "pass --file with a value" },
      { argv: ["example", "--name"], code: "usage", error: "pass --name with a value" },
      { argv: ["example", "--name", "--dry-run"], code: "usage", error: "pass --name with a value" },
      { argv: ["backtest", "--scenario"], code: "usage", error: "pass --scenario with a value" },
      { argv: ["propose", "--file", PROPOSE, "--rpc"], code: "usage", error: "pass --rpc with a value" },
      { argv: ["propose", "--file", PROPOSE, "--sign-env"], code: "usage", error: "pass --sign-env with a value" },
      { argv: ["sweep", "--file", SWEEP, "--report"], code: "usage", error: "pass --report with a value" },
      { argv: ["quote", "--file", QUOTE, "--audit"], code: "usage", error: "pass --audit with a value" },
    ]);
  });

  it("returns usage for an extra word or a flag the command does not accept", async () => {
    await expectRows([
      { argv: ["nope"], code: "usage", error: COMMANDS },
      { argv: ["Quote"], code: "usage", error: COMMANDS },
      { argv: ["help"], code: "usage", error: COMMANDS },
      { argv: ["--file"], code: "usage", error: COMMANDS },
      { argv: ["--file", QUOTE], code: "usage", error: "unexpected argument fixtures/sepolia/quote.json" },
      { argv: ["quote", "plain.json"], code: "usage", error: "unexpected argument plain.json" },
      { argv: ["quote", "--file", QUOTE, "extra"], code: "usage", error: "unexpected argument extra" },
      { argv: ["quote", "extra", "--file", QUOTE], code: "usage", error: "unexpected argument extra" },
      { argv: ["quote", "--name", "epoch"], code: "usage", error: "unexpected flag --name" },
      { argv: ["example", "--file", QUOTE], code: "usage", error: "unexpected flag --file" },
      { argv: ["backtest", "--file", QUOTE], code: "usage", error: "unexpected flag --file" },
      { argv: ["sweep", "--file", SWEEP, "--rpc", "http://127.0.0.1:9"], code: "usage", error: "unexpected flag --rpc" },
      { argv: ["propose", "--file", PROPOSE, "--report", "reports"], code: "usage", error: "unexpected flag --report" },
      { argv: ["cre-tick", "--scenario", "epoch-repay"], code: "usage", error: "unexpected flag --scenario" },
      { argv: ["cre-sweep", "--scenario", "epoch-repay"], code: "usage", error: "unexpected flag --scenario" },
      { argv: ["example", "--help"], code: "usage", error: "unexpected flag --help" },
    ]);
  });

  it("returns a coded error for a malformed flag and does not echo the value", async () => {
    const long = "a".repeat(401);
    const ftp = await respond(["propose", "--file", PROPOSE, "--rpc", "ftp://127.0.0.1/rpc"]);
    const named = await respond(["propose", "--file", PROPOSE, "--sign-env", "9KEY"]);
    const broken = await respond(["sweep", "--file", SWEEP, "--report", "bad\nname"]);
    await expectRows([
      { argv: ["quote", "--file=fixtures/sepolia/quote.json"], code: "usage", error: "unexpected flag --file=fixtures/sepolia/quote.json" },
      { argv: ["quote", "-file", QUOTE], code: "usage", error: "unexpected argument -file" },
      { argv: ["quote", "--"], code: "usage", error: "unexpected flag --" },
      { argv: ["quote", "--File", QUOTE], code: "usage", error: "unexpected flag --File" },
      { argv: ["quote", "--file", ""], code: "usage", error: "input: Too small: expected string to have >=1 characters" },
      { argv: ["quote", "--file", long], code: "usage", error: "input: Too big: expected string to have <=400 characters" },
      { argv: ["example", "--name", "nope"], code: "usage", error: NAMES },
      { argv: ["example", "--name", "Epoch"], code: "usage", error: NAMES },
      { argv: ["backtest", "--scenario", "nope"], code: "usage", error: SCENARIOS },
      { argv: ["propose", "--file", PROPOSE, "--rpc", "notaurl"], code: "param", error: "input: rpc must be an http(s) URL" },
      { argv: ["propose", "--file", PROPOSE, "--rpc", ""], code: "param", error: "input: rpc must be an http(s) URL" },
      { argv: ["propose", "--file", PROPOSE, "--sign-env", "HAS-DASH"], code: "param", error: "input: sign-env must name an environment variable" },
      { argv: ["propose", "--file", PROPOSE, "--sign-env", ""], code: "param", error: "input: sign-env must name an environment variable" },
      { argv: ["propose", "--file", PROPOSE, "--sign-env", "A".repeat(82)], code: "param", error: "input: sign-env must name an environment variable" },
      { argv: ["sweep", "--file", SWEEP, "--report", "bad\nname"], code: "param", error: PATTERN },
      { argv: ["quote", "--file", QUOTE, "--audit", "bad\rname"], code: "param", error: PATTERN },
    ]);
    expect(ftp).toEqual({ error: "input: rpc must be an http(s) URL", code: "param" });
    expect(JSON.stringify(ftp)).not.toContain("ftp://");
    expect(named).toEqual({ error: "input: sign-env must name an environment variable", code: "param" });
    expect(JSON.stringify(named)).not.toContain("9KEY");
    expect(broken).toEqual({ error: PATTERN, code: "param" });
    expect(JSON.stringify(broken)).not.toContain("bad");
    expect(JSON.stringify(await respond(["quote", "--file", long]))).not.toContain(long);
  });

  it("returns usage when flags conflict", async () => {
    await expectRows([
      { argv: ["example", "--dry-run", "yes"], code: "usage", error: "pass --dry-run without a value" },
      { argv: ["quote", "--file", QUOTE, "--dry-run", "1"], code: "usage", error: "pass --dry-run without a value" },
      { argv: ["example", "--dry-run=yes"], code: "usage", error: "unexpected flag --dry-run=yes" },
      { argv: ["example", "--name", "epoch", "--name", "weekly"], code: "usage", error: "pass --name once" },
      { argv: ["quote", "--file", "a", "--file", "b"], code: "usage", error: "pass --file once" },
      { argv: ["example", "--dry-run", "--dry-run"], code: "usage", error: "pass --dry-run once" },
      { argv: ["example", "--name", "epoch", "--scenario", "epoch-repay"], code: "usage", error: "unexpected flag --scenario" },
      { argv: ["backtest", "--scenario", "epoch-repay", "--name", "epoch"], code: "usage", error: "unexpected flag --name" },
      { argv: ["quote", "--dry-run", "--name", "epoch"], code: "usage", error: "unexpected flag --name" },
      {
        argv: ["propose", "--file", PROPOSE, "--rpc", "http://127.0.0.1:9", "--sign-env", "LOCKGATE_PROPOSER_KEY", "--report", "reports"],
        code: "usage",
        error: "unexpected flag --report",
      },
    ]);
  });

  it("accepts a command with its own flags", async () => {
    const result = await respond(["example", "--name", "weekly", "--dry-run"]);
    expect(isApiError(result)).toBe(false);
    expect(result).toMatchObject({ dryRun: true, command: "example", sent: false });
  });
});
