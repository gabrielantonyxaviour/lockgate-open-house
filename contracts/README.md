# Lockgate core contracts

## SUMMARY

Stage-1 own-book credit line is implemented and tested: MockUSDG, a 6-decimal adapter (including the Arbitrum Sepolia USDG proxy), pricing guardrails, first-loss reserve, repay-first queues (weekly, epoch, quarterly), and a demo fund factory. Gate: `FOUNDRY_PROFILE=core forge test` from this directory. `OpenCreditVault` and `LockgateExitPool` in `lockgate/SPEC.md` are door 2 and are not in this tree.

## PROGRESS

- 2026-10-02: Published `src/interfaces`, `INTERFACES.md`, and the core contracts. Accepted G7's book views `eligibleOutstanding` and `lateOutstanding` (owed-nav units). On-chain pricing refuses a fee above the max. The engine clamps. Token fee here is ceil. The engine's is half-up. Both are recorded in `INTERFACE-REQUESTS.md`. EIP-712 stays `AdvanceProposalLib` (`LockgateAdvance` / `1`). Core suite includes unit, fuzz, scenario, and one solvency invariant.

## Layout

| Path | What |
| --- | --- |
| `src/interfaces` | Surfaces other sessions compile against |
| `src/core` | Stage-1 contracts |
| `test/core` | Unit, fuzz, queue scenarios, solvency |
| `INTERFACES.md` | Behavior, reason strings, deploy order |
| `INTERFACE-REQUESTS.md` | Append-only. G6 decides |
| `lib` | forge-std 1.11.0, OpenZeppelin 5.3.0 |

`src/partner`, `src/facility`, `engine`, `harness`, `sim`, and `e2e` are other sessions. Do not treat a failure there as a core failure.

## Test

```bash
cd contracts
FOUNDRY_PROFILE=core forge test
```

Solidity 0.8.28, optimizer 200, Cancun, `via_ir` (see `foundry.toml`). Fuzz runs 256. The solvency invariant runs 40 times at depth 25 with `fail_on_revert = false`, and the handler only calls the public book. A deterministic draw, withdraw, slash, and repay walk sits beside it.

`via_ir` caches `block.timestamp` for the whole test function. After `vm.warp`, pass a literal. Do not read `block.timestamp` again in that function. `vm.prank` and `vm.expectRevert` bind the next external call, including a call hidden in an argument.

## Money, in one pass

A registered platform draws. The payee receives `navValue - fee`. The platform owes `navValue`. When its window runs, cash repays Lockgate before any investor in the queue. If that repayment does not fit, the window does not roll and the queue is not paid. After `dueAt + grace`, anyone may mark the advance late. The reserve is slashed into the line, up to the unpaid amount. The platform posted that reserve. The owner of the reserve cannot take it back below the required floor.

Demo pricing is about 1% on a 10-minute window because `timeScale` 4320 treats that wait as 30 days on a 12% base APR (99 bps, half-up). A 90-day window needs `timeScale` 1 or the fee is above the 1500 bps max and the draw is refused. Details and the 99 bps arithmetic are in `INTERFACES.md`.

Sepolia USDG used by the adapter: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, 6 decimals, named Global Dollar on the token page fetched 2026-10-02 (<https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892>). The adapter does not hold tokens. Swap mocks for that token by deploying a second adapter with `isMock = false`. `createDemoFund` mints only on a mock adapter.
