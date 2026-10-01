# Harness

## SUMMARY

Local Anvil test console for the Lockgate contracts in `contracts/`. It deploys the protocol, not the old fixture sources. The HTML page is a throwaway control panel, not the product.

## PROGRESS

- 2026-10-02: Bound the deploy to G6–G8 artifacts. CREATE2 covers the token, adapter, pricing, reserve, credit line, router, vault implementation, CreditLineBook, the facility, and two partner proxies.
- 2026-10-02: Dropped `FundFactory`. Init code is 49873 bytes and deployed bytecode is 49258 bytes, over the EIP-3860 limit of 49152 and the EIP-170 limit of 24576. Platforms are deployed directly and registered with `registerSource`.
- 2026-10-02: Stage-1 draw is `exitNow`. Repay is `depositCash` plus `processWindow`. The credit line is the reserve slasher.
- 2026-10-02: Partner `execute` is signed as `LockgateAdvance` / `AdvanceProposal`. The verifying contract is the vault. `quoteId` is the router's exit ref.
- 2026-10-02: Facility reads `CreditLineBook`. The stage-1 line exposes `eligibleOutstanding` and `lateOutstanding`.
- 2026-10-02: Sepolia broadcaster is gated. It was executed only against local Anvil chain id 421614. Public Sepolia was not deployed. Chain 42161 is refused.
- 2026-10-02: Flow test covers register, reserve, quote, draw, repay, late/slash, mandate, routed advance, and facility draw/waterfall.

## Run

```bash
cd lockgate/repo/harness
npm test
npm run anvil
HARNESS_RPC=http://127.0.0.1:8546 npm run deploy:local
HARNESS_RPC=http://127.0.0.1:8546 npm run serve
```

Anvil for this harness uses port 8546 or an ephemeral port. Port 8545 is refused. The server listens on `127.0.0.1` only.

`npm run deploy:sepolia` does nothing unless `LOCKGATE_ALLOW_SEPOLIA_DEPLOY=1` and `DEPLOYER_PRIVATE_KEY` are set and the RPC reports chain 421614. Do not export the published Anvil keys into that command on a public RPC.

Fixture sources under `harness/fixture/src` other than `Create2Factory.sol` and `ImportProxy.sol` are unused leftovers, including `HarnessBook.sol`. They are not deployed.
