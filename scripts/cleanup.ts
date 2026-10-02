import { main } from "../harness/src/cleanup.js";

void main(process.env, {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
}).then((code) => {
  process.exitCode = code;
});
