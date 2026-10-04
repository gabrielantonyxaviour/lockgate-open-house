# Official Paxos test USDG migration

This is a staged Arbitrum Sepolia TEST migration. The currently running Sepolia demo uses an older custom `MockUSDG` contract; that historical deployment, its manifest, API state and receipts remain intact until a new candidate has actual Paxos-issued test USDG in five vaults. This does not touch Arbitrum One or production Paxos USDG.

[Paxos lists Arbitrum Sepolia test USDG](https://docs.paxos.com/guides/stablecoin/usdg/testnet) at `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`. Read-only chain checks on 2026-10-04 returned `Global Dollar`, `USDG`, six decimals, and deployed code. The [Paxos faucet](https://faucet.paxos.com/) advertises 100 test tokens per request and one request per wallet per day. Faucet pages and grants can change; verify on-chain balances before execution. These test tokens have no redemption value.

## Funding gate

Two existing, controlled fixture signers need legitimate test USDG before migration. No automated faucet call or quota rotation is part of the script.

| Purpose | Arbitrum Sepolia recipient | Required on-chain balance |
|---|---|---:|
| Seed provider for all five vaults | `0xFEB5BEa526F53DA7757b83a3b2E40BC4561f2c0A` | 100 USDG |
| Originator TEST repayment source | `0x82130f97959Bb7410c6Fff67c3df43ca8499179D` | At least 20 USDG |

One ordinary 100-token Paxos grant to each of these distinct controlled wallets suffices: the first wallet deposits 20 into each vault; the second transfers 4 to each of the other four originator wallets and retains at least 4. The transfers and deposits are real ERC20 transactions. The demo does not assert the fictional organizations are real licensed firms or independent token funders. A user's own provider wallet needs its own ordinary Paxos faucet grant for a 10-USDG subscription; the service cannot mint official USDG. Arbitrum Sepolia ETH gas can be requested from the [Alchemy testnet faucet](https://www.alchemy.com/faucets/arbitrum-sepolia), subject to its terms.

The current preflight sees **zero** official test USDG in both recipient wallets. The old custom token's 2.5 million units cannot be converted into issuer test USDG. This is a funding prerequisite, not a deploy-script error.

## Smaller real-token fixture

The candidate deploys a **fresh** registry and settlement, preserving the old contracts and ledger, then creates five new vaults accepting only the official six-decimal token. Five fictional originators and five fictional firm managers accept TEST organization invitations on the new registry. Each vault receives 20 USDG from the same seed provider and has 20%-of-live-NAV exposure caps and 4-USDG per-originator/per-deal absolute limits. Eight TEST holdings are 3 units each; Birch remains full-exit only. Subscription minimum is 1 USDG, maximum 100 USDG. New wallet-issued TEST holdings are 3 units.

Example recording: a 10-USDG new provider deposit raises Meridian's initial 20-USDG NAV to 30. A 2-unit route-B exit quoted by Meridian pays 1.93 USDG immediately and creates a 1.9686-USDG originator repayment obligation. The investor retains 1 unit. Those figures use the existing 96.5% route-B price and 2% debt charge. The originator can repay from its separately sourced official test USDG. The provider's book NAV changes with the actual ledger; no fixed yield is promised. Offers remain subject to live cash, mandates, open withdrawal queue, and capped exposure.

## Read-only preflight and bounded execution

From the repository root:

```sh
bash scripts/demo/migrate-paxos-sepolia.sh --preflight
```

Preflight reads the private QuickNode RPC and local role-signer/deployer configuration without printing credentials or the URL. It confirms the public Arbitrum Sepolia genesis, official token metadata/code, a read-only ERC20 approval simulation, both exact token balances, current gas price, signer gas balances and the existing deployer floor. Approval simulation does not prove a later transfer or deposit; those require funded receipts. It does not create a journal or send a transaction. `ready:false` is expected until the two funding balances arrive.

After both actual token balances are verified and migration execution is explicitly authorized, the operator can use the same script with `--execute` and `LOCKGATE_ALLOW_PAXOS_MIGRATION=1`. It fails closed above a 0.02-ETH deployer outflow bound or below a 0.06-ETH deployer balance floor. On the 2026-10-04 read-only sample at about 0.06 gwei, its conservative 35-million-gas budget with a 1.5× price ceiling was 0.00315 ETH in potential burned fees, plus about 0.00119 ETH of reusable role-wallet gas float. These are estimates, not charges. The exact preflight must be rerun before execution.

Execution checkpoints every transaction hash and nonce into ignored, mode-0600 `scripts/demo/local/paxos-usdg-bootstrap.json`. An uncertain broadcast halts for nonce reconciliation; it does not blindly deploy again. Receipts require three confirmations and visible contract code. The script asserts five vaults each have `idleCash == 20_000_000`, one provider, the official asset address and 2000-basis-point exposure caps. Only after those checks does it write ignored candidate `paxos-usdg-manifest.json` and private `paxos-usdg-fixture.json`. Historical `sepolia-manifest.json`, `sepolia-fixture.json`, and `public-sepolia-state.json` are not overwritten.

The candidate API runner is `scripts/demo/serve-paxos-sepolia.sh`, which selects `LOCKGATE_DEMO_ASSET=paxos-usdg` and a separate `paxos-usdg-state.json`. It should replace the running API only after the public manifest, app amounts, state values, asset ABI, and browser flows agree with the verified candidate. Keep the localhost Vite process and old Anvil chain in place during this handoff. The browser's RPC remains the localhost proxy; the paid QuickNode URL stays private.

The on-chain receipt, not the faucet page or a form submission, proves receipt of test USDG. A new candidate does not prove Paxos partnership, production KYC, legal eligibility, or economically sustainable liquidity.
