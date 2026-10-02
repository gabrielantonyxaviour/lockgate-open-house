import { main } from "../harness/src/preflight.js";

void main(process.argv.slice(2), process.env, {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
}).then((code) => {
  process.exitCode = code;
});
