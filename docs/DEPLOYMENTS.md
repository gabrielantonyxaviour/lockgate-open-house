# Deployments

## Arbitrum Sepolia (chain 421614), 2 Oct 2026

Testnet only. Not live, not an offer. Deployed with `harness` `npm run deploy:sepolia` (`USE_PAXOS_USDG=1 SEED_STAGE1=1`).

- Token: real Paxos USDG on Arbitrum Sepolia, [`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) (6 dp, from the Paxos testnet faucet). No MockUSDG.
- Deployer and owner: `0xc37f3cC9C57F647212894a262F27fA21A371a752`. Governor `0x55b1342f7e9E3f2630eA1f548577fA7D5124d7af`, partner A `0x978165F3c035C3Da84cb937828C111506992047E`, partner B `0x3c8292Db97d87a079013B5350e2A12803d1e429F`.
- Seed: 300 USDG line capital; `WeeklyQueuePlatform` with a 1,000 USDG limit, 7.5% reserve (75 USDG) and 50 USDG cash; 600 s demo window.
- Post-deploy: `setGrace(60)` so the late path can be shown in minutes. Caps 8000/10000 bps (utilization/concentration).
- Platform creation is owner-only: a non-owner `createPlatform` reverts `OwnableUnauthorizedAccount` (checked on chain).
- Door 2 (`LockgateExitPool`, `OpenCreditVault`) is not deployed.
- Superseded: the first deployment of the same day (MockUSDG, permissionless factory) at `0x350F26a88bDB95FA589F74F999e3F44CF177CF4F` (credit line). Do not use it.

| Contract | Address |
|---|---|
| Create2Factory | [`0x8Af56Be997F7d5cDc70B3Cf32773e6453546A819`](https://sepolia.arbiscan.io/address/0x8Af56Be997F7d5cDc70B3Cf32773e6453546A819) |
| UsdgAdapter | [`0x57D9aAd9bb8559F78a13e5b2d5d597b8739EAD24`](https://sepolia.arbiscan.io/address/0x57D9aAd9bb8559F78a13e5b2d5d597b8739EAD24) |
| PricingEngine | [`0x0c2E226f4Da24975Aa3688a8abfbd034C594c06D`](https://sepolia.arbiscan.io/address/0x0c2E226f4Da24975Aa3688a8abfbd034C594c06D) |
| PlatformReserve | [`0xC5865AC922aCDA1C13fD06aF5b66CFfA6eAA333D`](https://sepolia.arbiscan.io/address/0xC5865AC922aCDA1C13fD06aF5b66CFfA6eAA333D) |
| LockgateCreditLine | [`0xd80B6cD54Af98eEc49300259762c483d60F90111`](https://sepolia.arbiscan.io/address/0xd80B6cD54Af98eEc49300259762c483d60F90111) |
| Router | [`0x9646c780e728C498f375768957330C50406E3370`](https://sepolia.arbiscan.io/address/0x9646c780e728C498f375768957330C50406E3370) |
| PartnerVaultImpl | [`0x125B96940df66AaF1316D26b91fa3FA9eb93B901`](https://sepolia.arbiscan.io/address/0x125B96940df66AaF1316D26b91fa3FA9eb93B901) |
| CreditLineBook | [`0x14c750ba2e54AAf18DB76BFD8841F2A713D522e7`](https://sepolia.arbiscan.io/address/0x14c750ba2e54AAf18DB76BFD8841F2A713D522e7) |
| CreditFacility | [`0x051Aca84903701E93AA387d6Dd554aF79D640e60`](https://sepolia.arbiscan.io/address/0x051Aca84903701E93AA387d6Dd554aF79D640e60) |
| PartnerVaultA | [`0xDa1AB87bC22730f21EC60F4B53f2271b95B6bAfb`](https://sepolia.arbiscan.io/address/0xDa1AB87bC22730f21EC60F4B53f2271b95B6bAfb) |
| PartnerVaultB | [`0xb2D6e88e71341B9aa415F9cA0E2Eb98F9a0FdaB1`](https://sepolia.arbiscan.io/address/0xb2D6e88e71341B9aa415F9cA0E2Eb98F9a0FdaB1) |
| WeeklyImpl | [`0x4f082d142eb4dFfb65e26bb8beD631bB750BF147`](https://sepolia.arbiscan.io/address/0x4f082d142eb4dFfb65e26bb8beD631bB750BF147) |
| EpochImpl | [`0x30D119F5C504F067F5CfE03cc929604D9942CA37`](https://sepolia.arbiscan.io/address/0x30D119F5C504F067F5CfE03cc929604D9942CA37) |
| QuarterImpl | [`0x7065255d1a89F1ee68263aC91772d78dC1b3633a`](https://sepolia.arbiscan.io/address/0x7065255d1a89F1ee68263aC91772d78dC1b3633a) |
| FundFactory | [`0x0f70e5Eeb646D60d104Be26ef5130926fDdAaBbA`](https://sepolia.arbiscan.io/address/0x0f70e5Eeb646D60d104Be26ef5130926fDdAaBbA) |
| WeeklyQueuePlatform | [`0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25`](https://sepolia.arbiscan.io/address/0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25) |
