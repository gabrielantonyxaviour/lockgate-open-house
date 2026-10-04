# TEST four-persona chain contract

This is an isolated demo sidecar. It reuses `core/UsdgTransfers.sol` exact-balance transfers;
it does not modify or weaken the owner-only `PartnerVault`. Every constructor requires chain
421614. Local Anvil uses that chain ID and a six-decimal mock ERC20; a later explicitly
approved Arbitrum Sepolia deployment can supply the verified six-decimal USDG address.
A local mock-token receipt must never be labelled a Paxos USDG receipt.

All organizations, licenses, identities and holdings are explicitly fictional TEST fixtures.
Onchain acceptance/signatures prove TEST authorization and accounting, not real KYC,
licensing, enforceability, actual asset custody or a commercial partnership. Kasu is not a fixture partner.
The registrar is authoritative only for these demo book holdings. No external asset or
ordinary redemption integration is claimed.

## Contracts and initialization order

1. Deploy `DemoRegistry(admin, identitySigner)` and `DemoSettlement(registry)`.
2. Admin `registry.configureSettlement(settlement)` once.
3. Admin `inviteOrganization(address,uint8 kind,bytes32 termsHash)`; kind 1 originator,
   kind 2 firm. Each invited address calls `activateOrganization(acceptedTerms)` itself.
   Seed five distinct originators and five distinct firms; neither invitation nor activation
   alone creates a real-world license.
4. Deploy each `DemoFirmVault(asset,registry,settlement,manager,termsHash)` after that firm
   activates. Admin `approveVault(vault)` for each. No manager sweep or upgrade function exists.
5. Admin `addTestIdentity(bytes32)` for each of the ten fixtures. Originator calls
   `registerHolding(id,ownerIdentity,units,routeMask,divisible)` for its positions.
   Identity references are opaque hashes of stable fixture IDs, never unlabelled real KYC IDs.
6. Each manager calls `setMandate(originator,totalLimit,dealLimit,routeMask)` for its whitelist.
   Route masks: 1 purchase only, 2 settlement finance only, 3 both, 0 revoked mandate.
   Manager `setExposureCap(originator,uint16 bps)` optionally adds a current-NAV percentage
   ceiling (0–10000); seed 2000 for 20%. Read `capConfigured(originator)` and `capBps(originator)`.
   Once configured, zero disables new allocation. Unset preserves the absolute-only behavior.
   Reserve and payout both enforce exposure including concurrent reservations against
   floor(totalAssets * bps / 10000), as well as existing absolute limits. NAV losses/withdrawals
   can suspend new allocations/payouts without blocking repayments, recoveries or cancellation.

Immutable contract addresses/terms, transaction receipts and events are the authority.
An admin can add approved demo fixtures but cannot withdraw providers' capital.
Configure only reviewed vault deployments: admin approval is a trust boundary.

## Actual wallet binding

Registry EIP-712 domain: name `LockgateTestIdentity`, version `1`, chainId `421614`,
verifyingContract registry. Type:

```text
Identity(address wallet,bytes32 identity,uint64 validUntil,uint256 nonce)
```

Use `identityDigest(wallet,identity,validUntil,nonce)` for the contract digest.
The configured TEST reviewer signs. The actual wallet calls
`bindIdentity(identity,validUntil,nonce,signature)`. Whitelist, expiry, nonce, signature,
wallet and domain are checked. An identity is permanently bound to its first authorized
wallet; this demo has no wallet-recovery workflow. The wallet can select another authorized
TEST identity, but the holding's original ownerIdentity never changes. Both reservation and
settlement require the currently selected identity to match. Wrong-owner and empty fixtures
cannot spend another identity's holding, even when selected using the same actual wallet.
`bindings(wallet)`, `identityWallet(identity)` and `matches(wallet,identity)` support reads.
Wallet signatures/transactions remain necessary; selecting a browser profile grants no rights.

## Provider subscription and capital

1. Current bound provider selects one firm vault.
2. That vault manager accepts scope and exact amount with
   `acceptSubscription(provider,identity,assets,deadline) -> id`.
3. Provider approves exact asset allowance to the **vault**, then calls
   `deposit(id,acceptedTerms,minUnits)`. The accepted terms hash must equal immutable
   vault terms. Current identity, exact accepted amount, deadline, single-use acceptance,
   minimum units and received token balance are enforced. The signed deposit transaction
   accepts that agreement and issues individual nontransferable internal book units.
4. Read `bookUnits(provider)`, `totalUnits()`, `totalAssets()`, `idleCash()`,
   `reservedCash()`, `availableCash()`, `outstandingPrincipal()` and events.

Units are internal accounting entries, with no ERC20 transfer/approval surface, no public
pooled-token issuance, no per-provider deal picking or custom lock toggle. Maximum ten
unique provider wallet accounts per vault bounds recovery accounting gas for this TEST demo.
The manager's acceptance is the vehicle-scoped eligibility decision; global TEST identity
verification alone never authorizes a subscription. Providers have no mandate/funding power.

NAV is idle cash plus carrying principal, excluding fixed cash claims and unsolicited token
donations. Deposits price at pre-transfer NAV. Received financing income raises NAV only on
collection. Positive supply with zero NAV blocks new deposits. Unsolicited donations are not
sweepable and do not create book entitlements.

## Exit quote, agreements and settlement

Domain: `LockgateTestSettlement`, version `1`, chainId `421614`, verifyingContract settlement.
EIP-712 primary type `Quote` (exact field order/types):

```text
Quote(bytes32 holdingId,address vault,address investor,bytes32 identity,
uint256 units,uint256 payout,uint256 repayment,uint8 route,uint64 deadline,
uint64 maturity,uint256 nonce,bytes32 agreementHash)
```

`quoteDigest(quote)` returns its digest. `agreementHash` binds the exact TEST package,
including old claim, counterparties, route-specific terms, costs and net payout.
The quote itself binds amount, parties, deadline, repayment and recipient.

1. Originator signs the digest, approving its specific holding/route and, for B, its named
   borrowing obligation. The investor is not the borrower.
2. Firm manager calls `reserve(quote,originatorSignature) -> digest`. Manager transaction
   approves those exact terms. It locks the original holding slice and reserves cash atomically.
   Registered vault, active originator, owner identity, divisible quantity, allowed route,
   unique investor nonce, per-deal cap, aggregate originator exposure and liquidity are checked.
3. Investor signs that exact digest. Any relayer may call `settle(quote,investorSignature)`.
   Current identity, deadline, signature, reservation and current mandate are rechecked.
   Payout to the quoted investor and rights update either both succeed or both revert.
4. A (`route=1`): original remaining holding decreases and
   `purchasedUnits(holdingId,vault)` increases. The deal records acquired rights and agreed
   collection cap; it is not automatically a new borrower financing debt.
5. B (`route=2`): original slice is discharged (`dischargedUnits(holdingId)`); the deal
   records originator as borrower with explicit agreed repayment. The original holding's
   residual is separate. No ordinary claim revival or automatic face-minus-payout income.

`deal(digest)` returns quote, originator, paid, status and impaired. Status values:
1 reserved, 2 settled/outstanding, 3 fully collected, 4 cancelled. Empty is 0.
No double payout or reused investor nonce. A changed package requires a new nonce/signatures.
A reservation expires in at most seven days; maturity is after expiry and within one year.
Investor/manager can `cancel(digest)` while reserved; anyone can after expiry. Cancellation
releases both locked units and cash, retains history and permanently spends the nonce.

## Repayment, impairment and recovery

Approve asset allowance to the deal's **vault**, then `settlement.repay(digest,amount)`.
Anyone can pay on behalf of the originator, but only their own approved funds are pulled.
Overpayment, zero, unreserved/unsettled/closed deals and unmatched token receipts revert.
Final A collection removes those units from current purchasedUnits and records collectedUnits;
closed rights cannot be collected twice.
Each payment proportionally amortizes original carrying principal with cumulative rounding;
one final principal unit remains until final collection. This prevents all providers leaving
an ownerless future income receipt. Collection above carrying-principal reduction is realized
income. A TEST acquired-right collection and B loan repayment have distinct route records.

Only that vault manager may `settlement.impair(digest)` after maturity. It writes remaining
carrying principal to zero, reduces exposure, and leaves unpaid collection rights intact.
Loss is borne by current book holders, including unfilled queued shares. Their exact unit
weights are snapshotted. Later recoveries become fixed `claimable` cash for those same loss
holders, including holders who subsequently withdraw all shares. New providers cannot take
historical recoveries. Cumulative rounding prevents tiny split repayments diverting recoveries. Unallocated
rounding cash remains reserved; only final collection residue goes to the last nonzero
loss holder in stable provider registration order. No legal forgiveness is implied by accounting impairment.

## Withdrawal policy fixed for this demo

`withdraw(units)` burns only caller-owned, unqueued units at current NAV and transfers only
available idle cash to caller. It cannot bypass a pending FIFO queue.
`requestWithdrawal(units) -> id` reserves caller's units; it does not fix a cash amount.
`cancelWithdrawal(id)` can cancel only caller's unfilled remainder.
Anyone may `processQueue(maxRequests)` (1–50), in FIFO order, partially if needed.
It burns filled units at current NAV, removes cash from provider NAV and fixes caller's
cash claim once. Unfilled units continue bearing gains/losses; settled claims do not.
`claim()` transfers only caller's fixed cash, and a failed transfer retains the claim.
Queued withdrawals block new exit reservations until queue processing/cancellation advances
past them. Previously committed reservations stay reserved. Call processQueue to skip cancelled
entries. Identity expiry stops new subscriptions/exits but cannot confiscate existing shares
or fixed claims. Zero-NAV units may be directly burned via withdraw if no queue remains;
recovery rights survive. Queued zero-NAV shares must be cancelled first.

## Validation and boundaries

Run `forge test --root contracts --match-path 'test/demo/*' -vv` from repository root.
The suite covers real ERC20 cash conservation, both rights routes, residual holdings,
wrong-identity same-wallet attempts, forgery/replay/domain boundaries, limits/concurrent locks,
subscription scope, FIFO/claim segregation, transfer failure rollback, impairment and later
recovery ownership. Local tests are not public-chain, custody or legal-clearance evidence.

Remaining integration responsibilities: actual USDG address verification before public testnet,
wallet connection/typed signing, ten fixture identity mapping, five-plus-five initialization,
reviewable exact TEST agreement documents/hashes, wallet-scoped discovery/event indexing,
submitted-transaction reconciliation, and real receipts for each frontend success claim.
