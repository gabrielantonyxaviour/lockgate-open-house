# Four persona journey contracts

Discussion specification · 4 October 2026 · no application implementation or legal clearance.

**Job:** let an existing investor obtain an earlier exit; let an originator enable and service it; let a licensed firm manage an authorized investment vehicle; let an eligible capital provider invest through that vehicle with individually recorded rights.

**Outcome:** before implementation, a reviewer can follow every screen, identify who may act, see what is signed and paid, and recover from every consequential interruption. Success means approved decisions plus testable journeys; these documents are not evidence those journeys run.

**Consequence:** legal execution and money movement may be irreversible. Every such action has a review of named parties, object, amount, rights, destination and expiry, followed by a durable reference. Browsing, editing drafts and selecting a task are reversible and need no financial confirmation.

| Read | Purpose |
|---|---|
| [Current entry and build order](entry-and-build-order.md) | Wallet/profile routing, concise onboarding, top-bar Demo sheet and five firm vaults; supersedes task-first arrival |
| [Exit investor](exit-investor.md) | Existing holding → eligible offer → signed settlement → reconciled payout |
| [Originating platform](originator.md) | Application → authority/integration → conditional activation → servicing |
| [Investment firm](investment-firm.md) | Verified firm/vehicle → mandate → capacity-backed bid → risk and client servicing |
| [Capital provider](capital-provider.md) | Eligibility → agreements → accepted subscription → personal shares → withdrawal |
| [Settlement and handoffs](settlement-and-handoffs.md) | Both legal routes, payment/asset locks, state ownership and agreement parties |
| [Decisions and launch evidence](decisions-and-evidence.md) | Open commercial policies, demand evidence and production gates |
| [Demo acceptance](demo-acceptance.md) | Five fictional originators, isolated actor wallets and testable proof |

## Shared arrival and interaction contract

| Screen | Sees | Actions | Authority | Confirmation | Recovery |
|---|---|---|---|---|---|
| App entry and profile check | Compact Connect wallet action, then Checking your profile | Connect; authenticate wallet control; retrieve scoped profile | Wallet authentication before private profile access; connection grants no financial permission | Complete profile → dashboard; incomplete → resume; new → four choices | Rejected connection, profile service failure and unknown profile differ; Retry cannot create duplicate identity |
| Four task choices | Connected new profile only: Exit an investment; Enable investor exits; Manage exit capital; Invest through a firm | Choose task; completed multi-role profiles use authorized workspace switching | Navigation only; no permission, licence or eligibility conferred | Chosen task retained; no repeated onboarding for completed profile | Account change reruns profile lookup; no public operations persona |
| Standalone terms | Specific fund/claim/vehicle, contracting entities, route, risks, fees, restrictions, source and date | Read/copy link, refresh terms, return to originating task | Public or legally gated offering access according to approved policy | No app sidebar; connected and disconnected users get the same document context | Missing, restricted, stale and unavailable distinguishable; preserve return path |
| Wallet and identity | Actual wallet, chain, connected permissions, identity binding and eligibility scope separately | Connect deliberately; sign nonce-bound control challenge; select wallet-bound TEST profile in demo | Wallet ownership proves control only; reviewer decides eligibility | Binding includes wallet, role, environment, policy, expiry; TEST provenance visible beside evidence | Account/chain/role change invalidates dependent unsigned reviews; old submitted hashes/history retained; no automatic identity migration |
| Consequential review | Object, legal party, exact amount/asset/network, recipient, fee, minimum, allowance, risk and legal effect | Change inputs; sign named document or authorize named transfer | Fresh scoped authority and prerequisites | Separate records for signature, counterpart acceptance, transaction submission, receipt and reconciliation | Reject returns to preserved review; changed terms require review again; unknown receipt blocks duplicate submission |

Current KYC-first, ten-identity fixture, managed enquiry/email and proposed co-funding details: [revision 5 contract](identity-enquiries-and-syndication.md).

## Rules applying to every screen row

All rows in this directory inherit **R1–R6**; additional per-document rules supplement them. These IDs come from the loaded product-design spec references, not from invented implementation standards.

- **R1 — scope and consequence:** `rule/name-object-scope-consequence`, `rule/irreversible-action-safeguard`, `rule/undo-only-when-honest`. Legal execution/transfers use review; no false undo. Submitted requests cancel only where the stated state machine permits it.
- **R2 — complete states and recovery:** `rule/cover-reachable-states`, `rule/error-states-recovery`, `rule/empty-state-action`, `rule/preserve-user-input`. Preserve safe drafts; private data stays scoped to its identity. Loading, never-created, filtered-empty, sparse, stale/partial, validation, denied, paused, pending, expired and offline each have a next action. Financial outcomes are never optimistically marked complete.
- **R3 — expiry and context:** `rule/time-limit-adjustable`, `rule/preserve-mental-model`, `rule/no-redundant-entry`. Warn before quote/acceptance expiry, keep the draft, and obtain a fresh offer; essential price validity is not silently extended. Resume deep links to their object.
- **R4 — focused interaction:** `rule/value-before-interruption`, `rule/one-primary-action`, `rule/navigation-vs-action`, `rule/inline-before-modal`, `rule/no-nested-modals`. Useful public exploration first; one emphasized action; ordinary links for destinations; inline detail before overlays.
- **R5 — accessible completion:** `rule/keyboard-complete-flow`, `rule/accessible-name-required`, `rule/auth-allows-assistance`, `rule/loading-stable-labels`. Named controls, visible focus, paste/password-manager support, stable action labels and specific status announcements. Check narrow/medium/wide layouts and long identifiers.
- **R6 — exact status:** `rule/success-state-specific`, `rule/no-confirm-ok-labels`, `rule/canonical-verb`. “Signed”, “Accepted”, “Transaction submitted” and “Paid” name different facts; success gives a durable reference and next step.

User-directed visual constraint: compact journey headings, no oversized onboarding hero; adapt the selected ReUI onboarding-8 composition to existing light Lockgate styling. A named reference is not evidence of acquired block code or a licence. Visual execution/verification routes to `ui-design`, animation to `ui-animation`, final wording to `copywriting`; this pass specifies behavior only.

## Current source boundary

Source inspected during this pass: `4e145061fc98d4c9522702efa8194e8a864895b3`. Existing app routes expose investor/issuer entry, local originator planning, owner capital and proposal controls. `PartnerVault.deposit/withdraw` are owner-only; `PartnerVaultRead.sharesOf` assigns all shares to the owner. There is no existing independent-provider product to relabel.

Existing means inspected source behavior, not fresh live execution. The complete journeys below are **proposed** unless a row explicitly names a partial current capability. No live commercial originating funds are registered; Kasu remains a prospect. Neither settlement route has legal clearance.

Source links: [routes](../../../src/ui/AppRoutes.tsx), [transactions](../../../src/chain/actions.ts), [wallet authority](../../../src/chain/wallet.ts), [owner vault](../../../../contracts/src/partner/PartnerVault.sol), [ownership reads](../../../../contracts/src/partner/PartnerVaultRead.sol), [existing blueprint](../index.html).
