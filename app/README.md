# Lockgate exit desk

Approved screen set, implemented in React + TypeScript + custom CSS. Layout hierarchy was reviewed against ReUI dashboard-8/app-shell-2/wizard-7/wizard-2/timeline-3/settings-3 and the official shadcn dashboard. No paid registry source or licensed bundles are included. Typography and tokens match `../site`.

## Run

```sh
npm ci
npm run dev
npm run build
npm test
npm run test:e2e
npm run lint
```

Development URL: http://127.0.0.1:5197. The default mode reads deployed Arbitrum Sepolia contracts. `/?preview=1#/overview` enables an explicitly labelled illustrative, read-only layout preview. Preview data never replaces failed live reads, and cannot send transactions.

## Screens

Public live overview; wallet connection and equal investor/platform journey choice; platform directory/detail; positions and requests; live exit quote; receipt and advance lifecycle; activity; issuer settlement and controls; own-book operations; partner vaults/mandates; partner proposal review; platform onboarding draft; integration references; settings/help. The optional judge guide follows connected-wallet contract state. Custom Radix Select controls support keyboard navigation and typeahead. Search opens with `/` or Cmd/Ctrl-K.

## Transaction boundary

An injected browser wallet is required for wallet actions. Writes use only chain421614 and the connected account. Inputs are validated with zod; amount conversion uses bigint. USDG approvals are exact amounts, contract calls simulate before signing, and receipts must be successful before a transaction is labelled confirmed. Quote freshness is checked immediately before sending; minimum received is enforced in the contract. A confirmation timeout retains its hash and disables immediate retry in that review. No private-key connector or admin key is shipped.

Permissions are determined by current owner/issuer/partner contracts and checked again during simulation. Browsing a workspace grants no permissions. Processing a due platform settlement window is permissionless. Platform registration verifies the actual factory owner, supports weekly/epoch/quarterly platforms, and decodes the created address from the confirmed receipt. Registration does not fund a platform or supply investor USDG.

## Boundaries

- Real Paxos test USDG on Arbitrum Sepolia; platform contracts are demonstrations. The network selector also supports Arbitrum One wallet switching; One displays an unavailable desk until its deployment is configured. Sepolia addresses are never reused on One.
- Partner proposals require imported complete engine JSON. The UI validates the chain, vault, terms, filed digest, nonce and mandate before partner approval. A hosted automatic proposal feed is not connected.
- Onboarding stores a bounded local planning draft and exports JSON. It does not submit documents, execute legal verification, accept facility terms, or activate a platform.
- Partner vaults currently require partner funding. The institutional senior/junior facility is linked read-only; lender onboarding is not enabled.
- Histories and queues are bounded; a larger deployment needs an indexed event/history service. Historical Advanced requests may have cleared advances; a Late advance with zero remaining is shown as recovered.
- RPC failures leave live data unavailable or visibly stale. They never silently switch to a populated preview.
- `wrangler.jsonc` serves the same Open House app at `openhouse.lockgate.finance` and `open-house.lockgate.finance`. `app.lockgate.finance` is not configured by this project.

Current contract addresses are from `../docs/DEPLOYMENTS.md`; source truth is `../contracts`. The older outer `SPEC.md` describes superseded permissionless creation and Door2 and must not be used as an integration contract.

Interface styling follows [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). Adapt registry components to shared tokens rather than preserving each reference’s styling.

## Journey and verification

Visitors see public contract metrics and explanatory platform windows immediately; wallet connection reveals the investor/platform choice. The optional `/#/judge` walkthrough checks the actual wallet, selected platform, gas balance, USDG, positions, permissions, and due windows. Old repaid receipts are historical inspection, not proof that a visitor completed the journey. Fresh platform registration is available to the factory owner at `/#/create`.

`LOCKGATE_FORK_TEST=1 npm run test:e2e -- test/fork-flow.spec.ts` runs an opt-in local Arbitrum Sepolia fork with a browser wallet, real contract receipts, deposit, quoted early exit, and repayment settlement. It broadcasts only to loopback Anvil; it requires `anvil`. Normal browser tests skip this scenario.
