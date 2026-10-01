# Lockgate core contracts

## SUMMARY

Stage-1 contracts cover both doors in `lockgate/SPEC.md`: the restricted-fund credit line (weekly, epoch, and quarterly queues) and the open token (`OpenCreditVault` plus `LockgateExitPool`). MockUSDG, the 6-decimal adapter, pricing guardrails, and the first-loss reserve sit underneath. Gate: `FOUNDRY_PROFILE=core forge test` from this directory.

## PROGRESS

- 2026-10-02: Security review of the stage-1 book. Grace is stored on the advance. A registrar cannot rewrite an open source. Utilization and concentration round up. Settlement walks at most 128 open requests. `push` rejects a short delivery. Notes are in `../docs/SECURITY-NOTES-contracts.md`.
- 2026-10-02: The factory constructor other sessions call is the seven-argument form. `PricingMath` is unchanged: 600 seconds is 99 bps, and 599 or 596 seconds is 98. A later Anvil block prices the seconds left in that block.
- 2026-10-02: Door 2 is in `src/core`. The open vault accrues 9% a year on MockUSDG. The exit pool pays `nav − fee` and `settle` claims the cooldown and repays the line. Core fuzz is 512 runs. Invariants run 64 times at depth 40. Added failure-path coverage for caps, windows, escrow dust, and factory config.
- 2026-10-02: Published `src/interfaces`, `INTERFACES.md`, and the core contracts. Accepted G7's book views `eligibleOutstanding` and `lateOutstanding` (owed-nav units). On-chain pricing refuses a fee above the max. The engine clamps. Token fee here is ceil. The engine's is half-up. Both are recorded in `INTERFACE-REQUESTS.md`. EIP-712 stays `AdvanceProposalLib` (`LockgateAdvance` / `1`).

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

Solidity 0.8.28, optimizer 200, Cancun, `via_ir` (see `foundry.toml`). The core profile fuzzes 512 runs. Solvency and queue invariants run 64 times at depth 40 with `fail_on_revert = false`. Handlers call the public book and the weekly queue only. A deterministic draw, withdraw, slash, and repay walk sits beside the solvency invariant. Stage-1 accounts token units. Peg checks stay in the engine and the facility.

`via_ir` caches `block.timestamp` for the whole test function. After `vm.warp`, pass a literal. Do not read `block.timestamp` again in that function. `vm.prank` and `vm.expectRevert` bind the next external call, including a call hidden in an argument.

## Money, in one pass

A registered platform draws. The payee receives `navValue - fee`. The platform owes `navValue`. When its window runs, cash repays Lockgate before any investor in the queue. If that repayment does not fit, the window does not roll and the queue is not paid. After `dueAt + graceOf(id)`, anyone may mark the advance late. `graceOf(id)` is the grace stored at draw. The reserve is slashed into the line, up to the unpaid amount. The platform posted that reserve. The owner of the reserve cannot take it back below the required floor.

Demo pricing is about 1% on a 10-minute window because `timeScale` 4320 treats that wait as 30 days on a 12% base APR (99 bps, half-up). A 90-day window needs `timeScale` 1 or the fee is above the 1500 bps max and the draw is refused. Details and the 99 bps arithmetic are in `INTERFACES.md`.

Sepolia USDG used by the adapter: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`, 6 decimals, named Global Dollar on the token page fetched 2026-10-02 (<https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892>). The adapter does not hold tokens. Swap mocks for that token by deploying a second adapter with `isMock = false`. `createDemoFund` mints only on a mock adapter.

Door 2 uses the same credit line with `reserveBps` 0. `OpenCreditVault` is an 18-decimal token. A 5-minute cooldown is the demo default from `lockgate/SPEC.md`. On MockUSDG the vault must be a minter, and a full year of the 9% APR (`900` bps, ACT/365) mints `9%` of assets. `sellToLockgate` accrues, pays the seller, and queues the withdrawal. `settle` is anyone, after `readyAt`. Real USDG does not auto-mint yield (`mintYield = false`).

`FundFactory` clones locked implementations. It does not embed platform bytecode. EIP-170 caps deployed bytecode at 24576 bytes (<https://eips.ethereum.org/EIPS/eip-170>). EIP-3860 caps init code at 49152 bytes (<https://eips.ethereum.org/EIPS/eip-3860>). Measured on 2026-10-02 with `FOUNDRY_PROFILE=core forge inspect` (solc 0.8.28, optimizer 200, via IR): factory init code 5763 bytes, deployed runtime 4729. The constructor takes the three implementation addresses after the reserve. Deploy order is in `INTERFACES.md`.
