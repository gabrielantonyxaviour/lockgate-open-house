# SUMMARY

Read-only fork of Arbitrum Sepolia USDG. No broadcast, no mainnet, no spend.

# PROGRESS

- 2026-10-02: `FOUNDRY_TEST=test/fork forge test` from `contracts/`. 5 tests passed.

# What is checked

The fork is the public endpoint `https://sepolia-rollup.arbitrum.io/rpc` at whatever block it serves now. Chain id is 421614. The token is `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` ([Arbiscan](https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892)): symbol `USDG`, 6 decimals, total supply greater than 0. A `deal` of 1,000e6 plus a 250e6 transfer conserves supply. A transfer of 101e6 from a 100e6 balance reverts and moves nothing. `UsdgAdapter` binds that address with `isMock = false` and `isCanonicalSepoliaUsdg = true`. Marking that same address as a mock reverts `CanonicalCannotBeMock`.

The 2026-10-01 pin, block 314719112, supply 2111011000100, is not served. The endpoint returns `historical state ... is not available` for the sequencer precompile, and that cheatcode error is not a Solidity revert, so the suite does not try the pin. Foundry's `block.number` on this fork is the parent-chain block, not the L2 block. The other 6-decimal token `0xB8981C1E85f5Acfbf1760Cb4DB3933526d8a269e` is not used.
