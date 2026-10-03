# Open House experience direction

The public home is the front door to a working financial application. It answers what Lockgate
does, what is visible on the selected chain, and why connecting a wallet is useful. The
onboarding journey begins after a visitor decides to use the product.

| Before | After | Why |
| --- | --- | --- |
| First arrival asks visitors to choose between two equally prominent roles | Public overview with product context, real balances, platform windows, and one wallet action | A visitor can understand the product before choosing a workflow |
| A passive dashboard assumes the visitor already knows the system | Every section explains the meaning and limits of its figures | Financial data becomes useful context |
| Factory and all role workspaces compete in primary navigation | Investor and platform journeys are primary; partner access is contextual; operations requires verified ownership | Navigation reflects a user's actual work |
| Generic tutorial steps are shown before intent | A short role choice follows connection, then guidance accompanies the next real action | Onboarding helps at the moment it is needed |
| A historical happy path can look like an action just completed | Guide steps distinguish current readiness, existing chain history, and transactions performed in this session | The interface never invents progress |

## Public home

Use the current monochrome design system, official brand assets, and a compact application
header. Keep the pre-wallet page free of a workspace sidebar. Adapt the existing dashboard
reference patterns through Lockgate's type, spacing, and shared controls; do not copy a
registry's visual skin.

The public page has four layers, in reading order:

1. Product explanation and wallet action. Investors understand the benefit; platforms understand
   that liquidity comes through a facility and is repaid at settlement.
2. Current public figures: own-book liquidity, outstanding principal, queued redemptions, and
   connected platforms. Unknown values remain unknown until a successful chain read.
3. A capital allocation view paired with the three-step exit explanation. The allocation is a
   present-state relationship, not an invented time series or a guarantee of exit availability.
4. Named platforms with actual redemption windows and queue values. Due windows are marked
   due; they are never silently rolled forward or described as future settlement promises.

Keep the first action focused: connect to find positions or access a facility. After connection,
the same panel clearly offers the workspace choice. Allow read-only platform inspection at
any time. Mainnet must show its unavailable state until contracts exist there. The selected
network remains visible in the header.

## Investor journey

After choosing investor, locate the connected wallet's holdings and redemption requests. A
wallet with no holdings needs a clear explanation and platform exploration, not an empty
chart or a disabled exit form with no recovery route.

For a position, compare waiting for the platform window against a current early-exit quote.
Present position value, quoted fee, exact USDG payout, availability, and quote freshness
together. A stepper represents the actual work: position, quote, review, wallet confirmation,
receipt. Approval and exit are distinct wallet actions. Cancellation or failure returns to a
useful state with the entered amount retained where safe.

The receipt uses the actual transaction hash and resulting request/advance. Existing chain
history can explain the lifecycle, but cannot satisfy a step requiring a new wallet action.

## Platform journey

Recognize verified issuer ownership before offering management actions. The platform overview
leads with settlement needs: cash, queue demand, repayment first, and any shortfall. Facility
limits, reserve obligations, and permission controls follow that operational picture.

Use brief forms and review screens for consequential changes. A platform without a configured
facility receives a clear setup path; a visitor without issuer permission receives read-only
context and a useful next action. Factory deployment remains a setup task, not a permanent
primary navigation destination.

## Capital partners and operations

Partner capital belongs to its own vault. Surface partner access through invitation/context
or verified ownership, and show the selected vault explicitly on every consequential screen.
Do not blend partner-vault and own-book balances into a single unlabeled total.

Operations belongs to the verified operator. Hiding navigation improves clarity, while the
existing contract and application permission checks remain responsible for authorization.

## Guide, motion, and verification

The quiet review guide stays available at `#/judge`. It is an optional explanatory path into
the same application, chain, permissions, and transaction review surfaces. Readiness and
historical evidence must remain visibly distinct from completed user actions.

Retain 160ms pointer feedback and the current reduced-motion behavior. Do not animate balances,
invent throughput, or add chart motion to an inactive facility. Settings use the existing
simple grouped layout; popovers and wizards reuse the shared controls and radii.

Inspect the final public home at 375px, 768px, and 1440px after route integration. Verify loading,
read failure, zero balances, stale reads, disconnected and connected wallets, due windows,
long platform names, keyboard focus, and the unavailable network. Confirm that connect-wallet
failure leaves a retryable action and no false onboarding completion.
