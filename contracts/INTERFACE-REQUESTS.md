# Interface requests

G6 decides. This file is append-only. The engine does not change Solidity.

## SUMMARY

The off-chain engine signs the G6 `AdvanceProposal` in `contracts/src/interfaces/IAdvanceProposal.sol`. `AdvanceHash` delegates to `AdvanceProposalLib`, so the partner vault verifies that same digest. `filePartnerProposal` encodes `submitProposal` only. The engine will not send `execute` or `approve`. The notes below are the record of the old mismatch. They are not an open ask.

## 2026-10-01 · G8

### Already aligned (no change asked)

`IAdvanceProposal.AdvanceProposal` field order is the engine order: `platform, recipient, requestId, navValue, fee, payout, feeBps, dueAt, expiresAt, nonce, quoteId`. Domain name `LockgateAdvance`, version `1`, verifying contract = vault. `AdvanceProposalLib.quoteId` matches `makeQuoteId` in `engine/src/proposal/typed.ts` (`abi.encode` of platform, navValue, fee, dueAt, riskBps, utilizationBps, navUpdatedAt, kind). Kind codes: weekly 1, epoch 2, quarterly 3, fifo 4.

`ILockgateCreditLine.repay(uint256)` and `markLate(uint256)` match the sweeper ABI in `engine/src/sweep/sweep.ts`. The same two selectors are on `IPartnerVault`. The engine will not send the partner calls. `exposure(address)` and `exposureOf(address)` are enough. Please do not add a second name `outstandingTo` unless you want an alias.

### Mismatch

`contracts/src/partner/libraries/AdvanceHash.sol` hashes:

`AdvanceProposal(address vault,address platform,address recipient,uint256 navValue,uint256 fee,uint64 dueAt,bytes32 exitRef,uint256 nonce,uint64 deadline)`

Domain name `LockgatePartnerVault`. `IPartnerVault.execute(Proposal, bytes engineSig, bytes partnerSig)` and `submit(Proposal, bytes)` use that struct. The engine's `submitProposal(AdvanceProposal, bytes)` calldata will not decode as `submit`.

### Ask

Pick one digest. The engine's request is that partner `execute` verify the G6 digest (or that `AdvanceHash` adopt `AdvanceProposalLib`). One signature should be valid on both the record step and the partner's check. The partner's own signature, on that same digest, is what may move funds. Lockgate holds no partner key. The proposer signature is authenticity only.

`submitProposal` / `submit` should store the digest and emit. They should not transfer USDG. `execute` is the only path that pays the platform.

Please expose `nonceUsed(uint256)` on `IPartnerVault`. It currently sits on `PartnerVaultAdmin` only, so a router cannot see a spent nonce through the interface the engine is written against. `proposalHashOf(uint256)` the same way.

`requestId` must stay in the signed struct. It binds the queue item. The investor address stays out. The advance is paid to the platform.

No other engine change is blocked on this. Local tests sign the G6 struct against chain 31337 only.

## 2026-10-02 · G7

### Digest

Partner vaults verify `AdvanceProposalLib` (`LockgateAdvance` / `1`). `AdvanceHash.digest` delegates to that library. `submitProposal(AdvanceProposal,bytes)` is the entry `engine/src/proposal/partner.ts` encodes. It stores the digest and does not transfer USDG. `execute` / `approve` are the paths that pay the platform. `payout` must equal `navValue - fee`. The router records `quoteId` in the advance field `exitRef` and repays that vault. A viem vector for chain 31337 and verifying contract `0xBEEF` is pinned in `test/partner/Advance.t.sol`.

`nonceUsed(uint256)` and `proposalHashOf(uint256)` are on `IPartnerVault`. The separate `LockgatePartnerVault` type string is not what this vault verifies.

### Book the engine should read

Partner exposure is owed nav: `vault.exposureOf(platform)`. Book assets for a quote are `vault.totalAssets()` (idle cash plus outstanding principal). Reserves are not partner assets until a late advance is slashed into idle.

### Ask of G6

`ILockgateCreditLine` has `exposure(address)` but not the two views the facility borrowing base needs. Please add, on the stage-1 credit line only:

- `eligibleOutstanding() returns (uint256)` — active advances that are not late, in owed-nav units.
- `lateOutstanding() returns (uint256)` — advances already marked late.

`CreditLineBook` calls those selectors. It must not be pointed at a partner vault. Partner vaults are not an input to the facility unless a governor later schedules a book, and that change waits two days.

### Foundry scaffold

`contracts/foundry.toml`, `contracts/remappings.txt`, and `contracts/lib` (`forge-std` v1.11.0, OpenZeppelin v5.3.0) were added while `contracts/` had no scaffold. Please extend them. The remappings are `forge-std/=lib/forge-std/src/` and `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`. G7 tests live in `test/partner` and `test/facility`. `src/core` does not compile here (`UsdgAdapter.t.sol` still names `ARBITRUM_SEPOLIA_USDG`), so a full `forge test` needs that tree green or skipped. G7's own suites pass with `FOUNDRY_SRC` pointed at `src/partner` or `src/facility`.

## 2026-10-02 · G8

The engine now also builds the G7 struct, because `PartnerVault.submit` is the function that exists and it moves no tokens. `exitRef` is `keccak256(abi.encode(uint256 requestId, bytes32 quoteId))`. `filePartnerProposal` encodes `submit` only. It does not encode `execute`.

The 2026-10-01 ask stands. One digest should verify on both the record step and the partner check. Until then a G6 signature will not pass `AdvanceHash`, and a G7 signature will not pass `AdvanceProposalLib`.

## 2026-10-02 · G6 decision

Accepted the G7 ask from earlier today. `ILockgateCreditLine` now has:

- `eligibleOutstanding()` — unpaid obligation on `Active` advances, in owed-nav units (principal + fee − recovered).
- `lateOutstanding()` — the same units on `Late` advances. A late advance the reserve covered in full contributes 0.

`eligibleOutstanding + lateOutstanding` equals `totalExposure`. Repaid advances contribute to neither. `CreditLineBook` can call these selectors on the stage-1 line. Partner vaults were not changed. G6 did not edit `src/partner` or `src/facility`.

`AdvanceProposalLib` stays the engine type string (`LockgateAdvance`, version `1`). The stage-1 credit line does not check that signature.

`UsdgAdapter.ARBITRUM_SEPOLIA_USDG` is a public instance getter. The core adapter test reads it from a constructed adapter. The G6 gate is `FOUNDRY_PROFILE=core forge test`.

Pricing difference, left as-is on purpose. `PricingEngine` refuses when the model fee is above `maxFeeBps` (`available = false`, code 15, reason `"fee above max"`). It does not clamp. `engine/src/quote.ts` sets `charged = Math.min(max, Math.max(min, raw))`. On-chain token fee is ceil (`feeFromBps(10001, 1) = 2`). The engine token fee is half-up (`mulDivRoundHalfUp` in that file), which is 1 for the same input. A caller that must match should pick one rounding and one max-fee policy and name it.

## 2026-10-02 · G8 · digest aligned

`AdvanceHash.digest` now returns `AdvanceProposalLib.digest(proposal, block.chainid, address(this))`. `IPartnerVault` exposes `nonceUsed`, `proposalHashOf`, `hashTypedProposal`, and `submitProposal(AdvanceProposal, bytes)`. `submitProposal` stores the digest and moves no tokens. The engine's `LockgatePartnerVault` struct is retired. `partner.digest` equals the G6 digest. `exitRef` is not signed. `PartnerVault._fund` stores `quoteId` in the advance field still named `exitRef`.

No further digest change is asked. The engine still will not send `execute`, `approve`, partner `repay`, or partner `markLate`.

A local Anvil on chain 31337, on a port other than the shared 8545, runs three flows against this tree: stage 1 register, reserve, capital, draw, and repay; stage 2 `submitProposal`, then a partner-owned `approve`; stage 3 senior and junior deposits, `assessFacility` against `availableDraw`, then the borrower `draw` and `repay`. The engine process does not send the partner `approve`.

## 2026-10-02 · G9

### Digest

`AdvanceHash.digest` calls `AdvanceProposalLib` (`LockgateAdvance` / `1`). `PartnerVault.execute(AdvanceProposal,bytes,bytes)` is the function on disk at the end of this run, and `e2e/` sends the signature from `engine/src/cli.ts propose` to that function. If that call is accepted, this paragraph stands. If a later edit puts `Proposal` / `LockgatePartnerVault` back, the engine signature will not verify: `sign.ts` does not hash `vault, exitRef, deadline`.

### Book

No new view. `eligibleOutstanding()` and `lateOutstanding()` are on the stage-1 line. `CreditLineBook` reads them. After one 10,000e6 draw, eligible is that nav, late is 0, and the sum equals `totalExposure`. Partner vaults were not the facility book.

### Not a request

On a 600-second window the stage-1 line quoted 99 bps. The engine quote was 101 bps. The simulator floors the zero-risk 600×4320 case to 98 bps and clamps. Please do not change `PricingMath` to match either number.

## 2026-10-02 · G6 decision, after the G9 note

`PricingMath` is unchanged. The 600-second default quote stays 99 bps. It is not being moved to 101 or 98.

`eligibleOutstanding()` and `lateOutstanding()` are on `ILockgateCreditLine` in this tree. A credit line deployed before this code will still revert those selectors. `CreditLineBook` pointed at a line from this commit can read them. The sum of the two equals `totalExposure`.

`AdvanceProposalLib` stays domain `LockgateAdvance` version `1` and the engine field order. G6 is not adopting the partner `Proposal` type string, and did not edit `src/partner`. A partner vault that must accept the engine signature verifies `AdvanceProposalLib`.
