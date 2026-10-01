# Threat model

## SUMMARY

Lockgate's threat boundary is who can move USDG. Stage 1 moves only Lockgate's own book. Stage 2 moves a partner's tokens only when that partner authorises the exact digest. Stage 3 moves facility cash along a fixed waterfall. The harness records those boundaries on local Anvil. This is not a pentest and not legal advice.

STRIDE names follow Microsoft's threat-model categories. https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats

## STRIDE

| Category | What the contracts do | Residual |
|---|---|---|
| Spoofing | Vault `execute` checks the proposer signature and then the partner. An investor can relay the transaction. Lockgate's key in the partner slot reverts `NotApproved` and does not consume the nonce. | A partner who sets Lockgate as `partnerSigner` or `autoModule` has chosen to delegate. The harness does not set either. |
| Tampering | EIP-712 binds platform, recipient, request id, nav, fee, payout, fee bps, due time, expiry, nonce, and quote id. https://eips.ethereum.org/EIPS/eip-712. The domain name is `LockgateAdvance` and the verifying contract is the vault. | A signature for another vault or another chain id does not pass. `quoteId` is the repayment id. |
| Repudiation | `AdvanceFunded`, `ExitFunded`, and `ProposalSubmitted` are on-chain events. The router stores the vault and advance id under the exit ref. | Events are only as available as the chain the harness is pointed at. |
| Information disclosure | The test console and manifest show Anvil's published development keys. https://book.getfoundry.sh/anvil/. | Those keys must not be funded on a public network. The Sepolia script does not put them in as owners unless the operator passes those addresses. |
| Denial of service | A platform that withholds repayment stops its own window. The credit line does not roll the window for them. A paused vault drops out of the quote. | One vault's pause does not pause the other. A paused credit line blocks new stage-1 draws. |
| Elevation of privilege | Reserve `setAdmin` accepts only the platform being registered. Slash accepts only a slasher, and the deploy sets the credit line as that slasher. Upgrade `executeUpgrade` is owner-only and waits out the delay. The harness schedules an upgrade and does not execute it. | The owner of a vault can schedule a new implementation after the delay. Lockgate cannot. |

## Economic attacks

- **Fee under the mandate.** The vault rejects a fee below `minFee` (floor division). The router charges the greater of the request fee and the mandate floor, rounded half-up, so the quoted fee is at least the floor. A 25 bps vault is preferred to a 50 bps vault by `BestFee` when both can fund the nav.
- **Lockgate pays itself from a partner vault.** The negative test runs before enlist. `withdraw`, `setPaused`, `setMandate`, and `Router.register` from the Lockgate key revert. After a real partner signature, idle cash falls by nav minus fee and, once the nav is repaid, the vault is ahead by the fee only.
- **Repayment to the wrong vault.** `relayRepay` reads the record for that exit ref and repays that advance. The router does not keep the tokens: it pulls, approves, repays, and checks the balance is back where it started.
- **Queue paid before the advance.** `processWindow` repays every open advance before it pays queued exits. If cash is short by one atomic unit, the advance stays open, the queue stays queued, and `nextWindow` does not move.
- **Facility loss shifted onto senior.** After a late advance, `poke` enters recovery. Junior idle cash covers senior drawn first (`subordinate`). `recognizeLoss` then takes junior principal before senior. The harness asserts junior principal fell and senior principal did not.
- **Borrowing base ignoring a late advance.** `CreditLineBook` reads `eligibleOutstanding` and `lateOutstanding` on the stage-1 line. The facility multiplies eligible by the advance rate. A late advance is in `lateOutstanding` and does not support a new draw. The harness facility uses that book.
- **Init-code factory.** Deploying `FundFactory` reverts. The harness does not raise Anvil's code-size limit to force it in. Platforms are deployed directly.
- **Oracle and peg.** The protocol deploy leaves the oracle at the zero address, which turns the peg check off. A failure test then deploys `harness/fixture/src/PegOracle.sol`, which is not in the protocol deploy. A price under the minimum returns preview reason 11 (Peg). An update older than the max age returns reason 12 (StaleOracle). Partner `approve` then reverts `MandateRejected` and idle does not move. No production oracle is deployed.
- **Mandate edges.** One atomic unit under the fee floor is reason 7. A deadline equal to the block timestamp still passes that check. One second earlier is reason 16. A tenor equal to the max passes that check. One second over is reason 8. A 1 bp concentration cap rejects a 200 USDG nav (reason 6) without moving idle.
- **Facility roles.** Governor and borrower are different addresses. The borrower cannot `approveLender`. The governor cannot `draw`. `solvent()` stays true across deposits, a draw, and a later stage-1 late mark. The facility's token balance matches `accounting.cash`. Eligible plus late stays equal to total exposure, including after the reserve slash leaves a late balance.
- **Chain confusion.** Writes to any chain other than 31337 revert in the harness client. Chain 42161 reverts as mainnet even if someone labels the RPC Sepolia. The Sepolia broadcaster reverts before a transaction when the node reports 42161. G10 checked that on a local Anvil whose chain id was 42161. No public mainnet call was made.

## Not claimed

No economic figure here is a forecast. Demo windows, facility APR, and the advance rate are labelled in `harness/src/params.ts` and `harness/src/deploy.ts`. Counsel has not reviewed this threat model. [U] MAS treatment of a proposal-only engine is the open item in the 1 Oct 2026 research note, not a conclusion of these tests.
