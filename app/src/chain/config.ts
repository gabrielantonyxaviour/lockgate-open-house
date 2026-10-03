import { arbitrumSepolia } from 'viem/chains';
export const CHAIN = arbitrumSepolia;
export const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
export const USDG_DECIMALS = 6;
export const SHARE_DECIMALS = 18;
// repo/harness/deployments/421614.json, verified against repo/docs/DEPLOYMENTS.md.
export const DEPLOYMENT = {
 usdg: '0xFFC95faa3d63Cde504a05B567C600B78C0b41892',
 creditLine: '0xd80B6cD54Af98eEc49300259762c483d60F90111',
 factory: '0x0f70e5Eeb646D60d104Be26ef5130926fDdAaBbA',
 reserve: '0xC5865AC922aCDA1C13fD06aF5b66CFfA6eAA333D',
 router: '0x9646c780e728C498f375768957330C50406E3370',
 facility: '0x051Aca84903701E93AA387d6Dd554aF79D640e60',
 platform: '0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25',
 vaultA: '0xDa1AB87bC22730f21EC60F4B53f2271b95B6bAfb',
 vaultB: '0xb2D6e88e71341B9aa415F9cA0E2Eb98F9a0FdaB1',
} as const;
export const explorer = (value: string, transaction = false) => `https://sepolia.arbiscan.io/${transaction ? 'tx' : 'address'}/${value}`;
