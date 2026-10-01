# Interface requests

G6 decides. This file is append-only. The engine does not change Solidity.

## SUMMARY

The off-chain engine signs the G6 `AdvanceProposal` in `contracts/src/interfaces/IAdvanceProposal.sol`. That digest matches `AdvanceProposalLib`. It also prepares G7 `submit` calldata for `LockgatePartnerVault`. The two digests differ. `submit` records only. The engine will not send `execute`.

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

## 2026-10-02 · G8

The engine now also builds the G7 struct, because `PartnerVault.submit` is the function that exists and it moves no tokens. `exitRef` is `keccak256(abi.encode(uint256 requestId, bytes32 quoteId))`. `filePartnerProposal` encodes `submit` only. It does not encode `execute`.

The 2026-10-01 ask stands. One digest should verify on both the record step and the partner check. Until then a G6 signature will not pass `AdvanceHash`, and a G7 signature will not pass `AdvanceProposalLib`.
