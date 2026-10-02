import { regressions } from "./regressions.js";

let failed = 0;
for (const row of regressions) {
  try {
    row.repro();
    process.stdout.write(`${row.kind} ${row.id} ${row.name} passed\n`);
  } catch (err) {
    failed += 1;
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${row.kind} ${row.id} ${row.name} failed\n`);
    process.stderr.write(`${row.id}: ${message}\n`);
  }
}
process.stdout.write(`${regressions.length - failed} passed, ${failed} failed, ${regressions.length} scenarios\n`);
if (failed > 0) process.exitCode = 1;
