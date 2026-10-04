# Lockgate local TEST runtime

This runtime is a disposable Anvil demonstration on chain ID `421614`. It uses a local `MockUSDG` ERC20 with six decimals. The chain, organizations, fund claims, identity attestations, firm subscriptions, reserves, payouts, and repayments are TEST fixtures. There is no public Sepolia deployment, production KYC, real fund participation, or Paxos-issued USDG in this setup.

## Start

From the repository root, in three terminal sessions:

```sh
bash scripts/demo/start-anvil.sh
bash scripts/demo/seed.sh
bash scripts/demo/serve.sh
```

The chain binds only to `127.0.0.1:8545`; the API binds only to `127.0.0.1:8788`. The app's Vite proxy forwards `/api/demo` to the API. `seed.sh` refuses a chain with an existing block so it cannot overwrite a running fixture. Stop only the Anvil process launched for this demo, restart it, then seed again for a clean reset. The server keeps its durable local state under ignored `scripts/demo/local/`; move aside that directory when intentionally resetting a fixture, then reseed and restart the API. Do not point these scripts at a public RPC.

The public generated `app/public/demo-contracts.json` contains addresses, firm policy text and policy hashes. The eight investor claim mappings are confined to ignored `scripts/demo/local/fixture.json` and authenticated chain reads. The public manifest does not expose which TEST person owns a position. The local fixture assigns signer indexes 0 admin; 1–5 originators; 6–10 firm managers; 11–15 initial liquidity providers. It funds local indexes 1–30 with Anvil gas. No private keys or mnemonic are emitted by the scripts.

## Seeded chain facts

- Five fictional originator organization wallets and five fictional investment firm wallets accept on-chain invitations.
- Five firm vaults each receive an actual 500,000 test USDG deposit from a distinct wallet and each have a manager-set 20% of live NAV exposure cap per originator plus a 100,000 test USDG absolute/deal limit.
- Eight TEST investor identities own recorded claims. The ninth selection, Nisha Rao, is a deliberate mismatch with the earlier holding identity; the tenth, Elias Haddad, has no claim. Neither case changes or leaks another person's holding.
- Each originator has 200,000 local test USDG for a real repayment flow. A wallet can request a one-time 10,000 test USDG faucet and one-time 0.01 local ETH gas grant after signed session authentication.
- The first five originators have seeded route masks 3, 1, 2, 1, 3. Birch's original claim is indivisible. Five firm bids have distinct fixed TEST discounts; the selected quote is rechecked before the manager reserves actual cash and locks the exact claim units.

## API contract

Every POST uses `Content-Type: application/json`. The API allows browser requests only from the local Vite origin. Except for `GET /config`, `GET /public`, `POST /challenge`, and `POST /authenticate`, all routes require `Authorization: Bearer <token>`. The token is a random secret; only its SHA-256 digest is stored, and sessions expire after 24 hours. All failures use `{ "error": "...", "code": "..." }`.

| Route under `/api/demo` | Request | Result |
|---|---|---|
| `GET /config` | — | Local chain ID, RPC, contract addresses, ABI, five firms and canonical policy text; no investor claim mappings. |
| `GET /public` | — | Live counts of active organizations and firms, five public TEST platform summaries with on-chain route masks, aggregate available cash/outstanding principal, current block. No private owner identity. |
| `POST /challenge` | `{account,chainId}` | One-use `message` and `nonce` bound to wallet and local chain. |
| `POST /authenticate` | `{account,chainId,message,nonce,signature}` | Verifies personal signature, returns `{token,state}`. |
| `GET /state` | — | Authenticated wallet's chain-backed `DemoState`, including profile, permitted positions, vehicles, receipts and workspace. |
| `POST /role` | `{role}` | Persists the wallet's chosen role and returns state. |
| `POST /identity` | `{profileId}` | Issues a registry EIP-712 attestation `{identity,validUntil,nonce,signature,registry}`; wallet must call `bindIdentity` before a position or provider action is available. |
| `POST /enquiries` | Reviewed institutional enquiry fields | Durable reference and honest acknowledgement status. Outbox is queued until a verified Lockgate sender is configured. |
| `POST /offers` | `{positionId,amount}` | Up to five exact signed, indicative firm quotes with distinct price/route and no cash lock. The service checks current mandate, route, cash, withdrawal queue, and NAV exposure cap before presenting each bid. |
| `POST /reserve-offer` | `{offerId}` | Rechecks identity, claim and firm mandate, then has the TEST firm manager reserve the selected quote on chain. |
| `POST /exit-signature` | `{offerId,signature}` | Verifies the wallet's EIP-712 quote signature and persists exact agreement acceptance. Wallet or a relayer can then call settlement `settle`. |
| `POST /eligibility` | `{vehicleId}` | Re-reads provider eligibility and state. |
| `POST /subscription` | `{vehicleId,amount}` | Returns exact amount-specific policy message to sign. Repeat with `{vehicleId,amount,signature}` to verify it and submit firm `acceptSubscription`; returns `{id,termsHash,vault,minUnits,amount,receipt}`. Wallet approves token, then calls vault `deposit`. |
| `POST /subscription-resume` | `{vehicleId,amount}` | Rechecks an exact accepted, unfunded, unexpired on-chain subscription and returns its original ID and minimum units after a reload. Funded or stale terms require a new signature. |
| `POST /mint-position` | `{}` | Originator-authorized local TEST claim registration for the wallet's bound identity, with actual transaction receipt. |
| `POST /faucet` | `{}` | One-time actual local MockUSDG mint, 10,000 units. |
| `POST /gas` | `{}` | One-time local Anvil gas transfer, 0.01 ETH. |
| `POST /receipts` | `{hash,title,amount?}` | Reads mined status for a transaction from this wallet to an approved demo contract, then derives canonical title, amount and residual from calldata and chain events. Client title/amount are ignored. |
| `POST /workspace-action` | `{actionId,inputs}` | Chain-validated wallet transaction intent `{title,amount?,transactions:[{address,abi,functionName,args}]}`. The service does not silently sign dashboard controls for an organization. |

`workspace-action` supports `originator.register-holding` (`profileId,units,routeMask,divisible`), `originator.repay` (`digest`; exact remaining debt with token approval), `manager.set-mandate` (`originatorAddress,exposurePercent,dealLimit,routeMask`), `manager.process-queue` (`maxRequests`), and provider queue actions `provider.claim`, `provider.process-queue`, `provider.cancel-withdrawal` (all with `vehicleId`, last also `requestId`). The connected wallet must match the invited organization for originator and manager actions. Firm bid reserves and provider subscription acceptance are explicitly authorized local fixture services; user dashboard controls are wallet transactions.

The subscription policy hash is `keccak256` of the same canonical five-paragraph policy text shown in the API. The signed subscription message embeds that text verbatim together with wallet, vehicle, exact amount, nonce and expiry. A firm accepts that amount on chain; provider deposits exactly it or the transaction fails. `minUnits` is computed from live NAV and units at acceptance and prevents a later lower unit allocation.

The authenticated state lists only this wallet's active on-chain reservations, exact signed agreement texts, and per-vehicle withdrawal requests. A wallet can cancel its own active reservation with settlement `cancel`; the next state read removes it. Signed subscription history is append-only across later deposits and reads each acceptance's funded status from chain. A new deposit needs a new amount-specific signature and acceptance.

## Known boundaries

The HTTP service is for localhost demonstration and has no production operator isolation. Identity attestations certify TEST choices only. Indicative bids can become unavailable as cash, limits or claims change; the reserve endpoint checks current chain state and returns an error instead of changing price or route. The outbox records an enquiry before any email attempt; it reports queued, retry, or provider-accepted status and never calls provider acceptance “delivered.” Live email requires separately verified Lockgate-specific credentials. A chain reset invalidates earlier API state and receipts; reset both local processes and local state together.
