import { main } from "../harness/src/checksum.js";

process.exitCode = main(process.argv.slice(2), process.env, {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
