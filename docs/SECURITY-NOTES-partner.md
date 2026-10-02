# Security notes — partner vault and credit facility

## SUMMARY

Reviewed the partner vault, router, auto-approve module, and credit facility on 2026-10-02. The pass covered access control, reentrancy, rounding, oracle staleness, signature replay, denial of service, griefing, and economic attacks. Seven findings were fixed in `contracts/src/partner` and `contracts/src/facility`, with regressions in `contracts/test/partner/Security.t.sol` and `contracts/test/facility/Security.t.sol`. This is not a pentest and not a legal opinion. Lockgate still has no key that can move partner USDG.

Partner-vault trust assumptions and privileged roles, each named to a test under `contracts/test/partner`, are in `contracts/src/partner/SECURITY-NOTES.md`.

## Findings

| Id | Class | What was wrong | Fix |
|---|---|---|---|
| P-1 | DoS | `quote` called every registered vault with the router's full gas. One owner can register a contract whose `mandate`, `maxNav`, `idle`, or `preview` reverts or loops. Every strategy then reverted, including quotes that had an honest vault. A `maxNav` of `type(uint256).max` also overflowed the pro-rata sum. | Each probe is a staticcall capped at 2,500,000 gas. Failure, or a cap above `uint128`, leaves that vault out. The others are still quoted. |
| P-2 | Oracle | The vault decoded `latest()` and `gated()` as `uint64` and `bool`. A wide timestamp, or a bool other than 0 or 1, reverted the decoder. `preview` and `execute` died instead of returning `StaleOracle` or `Gated`. The same decode sits on the facility peg, and `try/catch` does not trap it under solc 0.8.28 with via IR. | Both sides read raw words. A bad oracle is stale. A non-zero gate flag is closed. A book word shorter than 32 bytes is an unreadable book. |
| P-3 | Economic | `markLate` used the live `grace`. After funding, the owner could `setGrace(0)` and slash the platform reserve at `dueAt`, before the grace the advance was funded under. | The grace is stored on the advance at funding. Read it with `graceOf(id)`. `grace()` is the value the next advance will store. |
| P-4 | Economic | The auto-approve module enforced a fee floor and not a ceiling. A proposer signature with `fee == nav - 1` passed the module. The platform would owe the full nav and receive 1 unit. | `Bounds.maxFeeBps` caps both `feeBps` and the fee amount. The ceiling cannot sit below the floor. |
| F-1 | Economic | `recognizeLoss` used `drawn - borrowingBase`. `borrowingBase` is `advanceRate * eligible`. `tightenAdvanceRate(0)` is immediate, so the governor could book the whole draw as a loss while the receivables still covered it. That forgives the borrower and writes down lenders. Recovery correctly stays in force. | The loss is the draw above eligible receivables. An unreadable book covers nothing. The advance rate still blocks new draws. |
| F-2 | Economic | `executeTerms` stored the new APR before accruing. The open period, including the two-day wait, was then priced at the new rate. | `executeTerms` accrues at the old rate, then stores the new one. |
| F-3 | Griefing | Recovery is sticky and `recognizeLoss` is permissionless. A junior deposit in recovery becomes idle junior cash. The next loss or repayment subordinates it to senior before the depositor can leave. | Junior deposits revert once `recovery` is true. Senior deposits still cure cash. |

## Reviewed, no code change

- Partner authorisation sits on top of the engine signature. `execute` accepts the owner, the partner signer, the auto-approve module, or an ERC-1271 signature over the same digest. `approve` is only the owner or the signer, and only for a digest `submitProposal` already stored. Lockgate is not one of those addresses.
- The EIP-712 domain is `LockgateAdvance` version `1`, bound to `block.chainid` and the vault. A signature from another vault or another chain fails `BadEngineSig`. `execute` burns the nonce before the transfer and before `notifyFunded`. `approve` requires the stored digest. A second submit of a filed nonce reverts.
- Signature checks go through `SignatureChecker.isValidSignatureNow`, which staticcalls ERC-1271. The signer cannot move vault state inside that check. Token-moving functions use `nonReentrant`. `relayRepay` checks the router's balance before and after and clears the approval.
- Pulls require the vault balance to already match idle plus reserve, then to rise by the full amount. Pushes require that match after the books are reduced, and the recipient balance to rise by the full amount. A fee-on-transfer token, a transfer that returns false, or a rebase that leaves a deficit reverts. A surplus sits until the owner calls `skim`. A deficit cannot be skimmed, so pulls and pushes stay blocked until the token balance is restored. The vault has one depositor, the owner, so a donation cannot inflate a stranger out of the share price.
- Mandate fee floor is `floor(nav * minFeeBps / 10000)`. One unit under that is `Fee`. `payout` must be `nav - fee`. The router's quoted fee is half-up and is clamped below `nav`.
- Reserve required for a new advance is `ceil(exposureAfter * reserveBps / 10000)`. `markLate` moves `min(reserve, owed)` into idle. It does not pay the caller. The platform, not the partner and not Lockgate, withdraws unused reserve down to that floor.
- The oracle treats a future timestamp, `maxOracleAge == 0`, or age past the max as stale before it treats a low price as a depeg. Address zero disables the check. The same order is used for the facility peg. A failed facility oracle read is a breach.
- Facility shares are not transferable. The 50-lender cap counts addresses ever approved, and a revoke does not free a seat. The governor and the borrower must differ. The governor cannot withdraw lender principal. Pulls and pushes require the token balance to match cash, and a push requires the recipient to receive the full amount. `bookSurplus` books a surplus as residual. A deficit stays blocked until the balance is restored. `sweepResidual` pays only residual, and not while senior drawn, senior deficit, or senior interest is still open.
- Repayment pays senior interest, senior principal, senior deficit, then the junior legs, then residual. Loss hits junior principal first. Interest is `floor(floor(principal * apr / 10000) * dt / 365 days)`. Dust that does not divide across the index stays in residual.
- `submitProposal` still stores the digest before `preview`. A filed nonce that the mandate will reject stays occupied until the owner cancels. Cancel burns the nonce. It does not free it.

## Residual

- The address stored as `autoModule` may call `execute` with an empty partner signature. Bounds exist only inside `AutoApproveModule`. A different contract at that address is not held to those bounds. The engine signature and the mandate still apply.
- `relayRepay` pays whichever registered vault recorded that `(exitRef, vault, advanceId)`. A contract that lies in `getAdvance` can append a record. The caller has to repay the vault from the quote, not "the first record for this id".
- `quoteId` does not include the nonce or the vault. Two vaults can fund the same id. Repayment selects the record index.
- A vault that honestly needs more than 2,500,000 gas inside `maxNav` is skipped by `quote`. The partner can still fund it directly.
- Recovery does not end. Pointing the facility at a new book waits two days. The book it already points at can report a lower `eligibleOutstanding`, and `recognizeLoss` will use that number. The governor is trusted with that book.
- Reserve cash posted against a platform can be withdrawn by that platform. It is not a partner balance. A partner who posts it has handed it to the platform's first-loss bucket.
- The engine fee is half-up and the vault floor is a floor. A signed fee can be one unit above the on-chain minimum. The vault does not round it back down.
- Queue cash, NAV, and the peg the engine saw are not re-read from the outside world here. The vault re-checks its own mandate at `approve` and `execute`.
