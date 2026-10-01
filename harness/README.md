# Harness

## SUMMARY

Local Anvil test console for the Lockgate contracts in `contracts/`. It deploys the protocol, not the old fixture sources. The HTML page is a throwaway control panel, not the product.

## PROGRESS

- 2026-10-02: Bound the deploy to G6–G8 artifacts. CREATE2 covers the token, adapter, pricing, reserve, credit line, router, vault implementation, CreditLineBook, the facility, and two partner proxies.
- 2026-10-02: CREATE2 now deploys the 7-argument clone factory, three locked implementations, `OpenCreditVault`, and `LockgateExitPool`. G6 measured that factory at 5763 init bytes and 4729 runtime bytes. The old embedded factory (49873 / 49258) is not deployed. The weekly short-cash platform stays direct CREATE. The epoch demo uses `createPlatform`.
- 2026-10-02: Stage-1 draw is `exitNow`. Repay is `depositCash` plus `processWindow`. The credit line is the reserve slasher.
- 2026-10-02: Partner `execute` is signed as `LockgateAdvance` / `AdvanceProposal`. The verifying contract is the vault. `quoteId` is the router's exit ref.
- 2026-10-02: Facility reads `CreditLineBook`. The stage-1 line exposes `eligibleOutstanding` and `lateOutstanding`.
- 2026-10-02: Sepolia broadcaster is gated. It was executed only against local Anvil chain id 421614. Public Sepolia was not deployed. Chain 42161 is refused.
- 2026-10-02: Flow test covers register, reserve, quote, draw, repay, late/slash, door 2 sell/settle, mandate, routed advance, partner approve, factory-cloned epoch, and facility draw/waterfall.
- 2026-10-02: `stage2.approve` files the proposal from the engine. The partner `approve` pays. Lockgate `approve` reverts `NotApproved` and does not move idle.
- 2026-10-02: The facility governor is Anvil account 7. The borrower stays account 0. Lender approval is sent as the governor.
- 2026-10-02: Failure tests cover a bad engine signature, nonce replay, faucet cap, a closed window, a stranger draw, and a peg or stale oracle. `PegOracle` is only deployed in that test.
- 2026-10-02: Invariant checks keep eligible + late = exposure, vault tokens = idle + reserve, and facility `solvent()` with tokens matching `accounting.cash`. Fuzz checks the fee ceiling for 256 draws.

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

`npm test` builds `contracts/` with `forge build --skip test` and then builds `harness/fixture`. The old `--skip LockgateExitPool` is gone. CI runs `forge test` with no skip.

Fixture sources under `harness/fixture/src` other than `Create2Factory.sol`, `ImportProxy.sol`, and `PegOracle.sol` are unused leftovers, including `HarnessBook.sol`. `PegOracle` is deployed only by the failure test. The others are not deployed.
