# Samples

These files are documents the engine already accepts. `test/examples.test.ts` parses them with the zod schemas, then builds each propose body with the quote clock as the wall. A submittable body returns an `AdvanceProposal`. They contain no key.

- `mandates/epoch.json`, `mandates/quarterly.json`, and `mandates/fifo.json` are mandate schema version 2 (`lockgate://schema/mandate/2`).
- `mandates/legacy.json` is version 1. It names the tenor `maxTenor`. `parseMandate` copies that to `maxTenorSeconds`.
- `proposals/epoch.json`, `proposals/weekly.json`, `proposals/quarterly.json`, and `proposals/fifo.json` are `propose` bodies: a quote, pricing params, and a mandate. Epoch, quarterly, and fifo use the matching version 2 mandate. Weekly uses the legacy mandate after that copy.
- The quarterly book waits 7,776,000 seconds, the same span as its `maxTenorSeconds`, and the fee is 328 bps. The epoch fee is 109 bps. The weekly wait is 432,000 seconds and the fifo wait is 86,400 seconds. Both sit on the 25 bps floor.
