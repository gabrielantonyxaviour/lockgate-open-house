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

Overview; platform directory/detail; positions and requests; live exit quote; receipt and advance lifecycle; activity; issuer settlement and controls; own-book operations; partner vaults/mandates; partner proposal review; platform onboarding draft; integration references; settings/help. The optional judge guide follows connected-wallet contract state. Custom Radix Select controls support keyboard navigation and typeahead. Search opens with `/` or Cmd/Ctrl-K.

## Transaction boundary

An injected browser wallet is required for wallet actions. Writes use only chain421614 and the connected account. Inputs are validated with zod; amount conversion uses bigint. USDG approvals are exact amounts, contract calls simulate before signing, and receipts must be successful before a transaction is labelled confirmed. Quote freshness is checked immediately before sending; minimum received is enforced in the contract. A confirmation timeout retains its hash and disables immediate retry in that review. No private-key connector or admin key is shipped.

Permissions are determined by current owner/issuer/partner contracts and checked again during simulation. Browsing a workspace grants no permissions. Processing a due platform settlement window is permissionless. Platform creation remains owner-only; the frontend does not pretend a visitor can create an isolated funded sandbox.

## Boundaries

- Real Paxos test USDG on Arbitrum Sepolia; platform contracts are demonstrations. The network selector also supports Arbitrum One wallet switching; One displays an unavailable desk until its deployment is configured. Sepolia addresses are never reused on One.
- Partner proposals require imported complete engine JSON. The UI validates the chain, vault, terms, filed digest, nonce and mandate before partner approval. A hosted automatic proposal feed is not connected.
- Onboarding stores a bounded local planning draft and exports JSON. It does not submit documents, execute legal verification, accept facility terms, or activate a platform.
- Partner vaults currently require partner funding. The institutional senior/junior facility is linked read-only; lender onboarding is not enabled.
- Histories and queues are bounded; a larger deployment needs an indexed event/history service. Historical Advanced requests may have cleared advances; a Late advance with zero remaining is shown as recovered.
- RPC failures leave live data unavailable or visibly stale. They never silently switch to a populated preview.
- `wrangler.jsonc` points to `dist` at the previously established hosting target. This task does not deploy or enable automatic publishing.

Current contract addresses are from `../docs/DEPLOYMENTS.md`; source truth is `../contracts`. The older outer `SPEC.md` describes superseded permissionless creation and Door2 and must not be used as an integration contract.

Interface styling follows [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). Adapt registry components to shared tokens rather than preserving each reference’s styling.
