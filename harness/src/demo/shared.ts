import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { publicAccountAt } from './public-signers.js';

const network=process.env.LOCKGATE_DEMO_NETWORK??'local';
if(network!=='local'&&network!=='arbitrum-sepolia')throw new Error('Unsupported demo network');
export const publicNetwork=network==='arbitrum-sepolia';
export const networkLabel=publicNetwork?'Arbitrum Sepolia TEST':'Lockgate local TEST';
export const genesisHash='0x77194da4010e549a7028a9c3c51c3e277823be6ac7d138d0bb8a70197b5c004c' as Hex;
const requestedRpc=process.env.LOCKGATE_DEMO_RPC_URL;
if(publicNetwork){
 if(!requestedRpc)throw new Error('Sepolia QuickNode RPC is missing');
 const url=new URL(requestedRpc);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.quiknode.pro'))throw new Error('Sepolia RPC must be an HTTPS QuickNode endpoint');
}
export const rpc=publicNetwork?requestedRpc!:'http://127.0.0.1:8545';
export const clientRpcUrl=publicNetwork?'http://127.0.0.1:5197/api/demo/rpc/421614':rpc;
export const chain = { id: 421614, name: networkLabel, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
export const publicClient = createPublicClient({ chain, pollingInterval:publicNetwork?1000:4000, transport: http(rpc,{batch:{wait:10,batchSize:50},timeout:15000,retryCount:2}) });
// Anvil's documented local-only mnemonic. Never use these accounts on a public network.
const mnemonic = 'test test test test test test test test test test test junk';
export const accountAt = (index:number) => publicNetwork?publicAccountAt(index):mnemonicToAccount(mnemonic, { addressIndex:index });
export const walletAt = (index:number) => createWalletClient({ account:accountAt(index), chain, transport:http(rpc,{timeout:15000,retryCount:2}) });
export const identityHash = (ref:string):Hex => keccak256(toHex(ref));
export const vehicleTermsText=(label:string)=>[
 `Lockgate ${publicNetwork?'Arbitrum Sepolia':'local'} TEST vehicle terms v1 — ${label}. This fictional firm-managed vehicle accepts only 6-decimal ${publicNetwork?'testnet':'local'} TEST USDG on chain 421614; it is not a live investment product.`,
 'The firm accepts a wallet-bound TEST identity and an exact subscription amount before a provider deposits. Deposits receive nontransferable book units priced from the vehicle net asset value at the time of deposit.',
 'Vehicle cash may fund permitted early exits. A purchase acquires claim rights; a financing discharges the investor claim and creates a separate originator repayment obligation. Mandate limits and available cash restrict each reserve.',
 'Withdrawals are paid immediately only while there is no open queue and enough available cash. Otherwise a request enters a first-in, first-out queue. Queued units remain exposed to changes in net asset value until filled; filled amounts must be claimed.',
 'Capital is at risk. Delayed recovery or impairment can reduce principal and net asset value; income is not guaranteed. TEST identity verification is a fixture, not production KYC, legal eligibility, or approval.'
].join('\n\n');
export const terms = (label:string):Hex => keccak256(toHex(vehicleTermsText(label)));
export const organizationTerms=(label:string):Hex=>keccak256(toHex(`Lockgate ${publicNetwork?'Arbitrum Sepolia':'local'} TEST organization invitation v1 — ${label}`));
export const people = [
 ['alex-morgan','Alex Morgan','Singapore'],['priya-menon','Priya Menon','India'],
 ['lucas-chen','Lucas Chen','Singapore'],['sofia-reyes','Sofia Reyes','Spain'],
 ['daniel-okafor','Daniel Okafor','United Kingdom'],['hana-kim','Hana Kim','South Korea'],
 ['amara-wilson','Amara Wilson','Canada'],['mateo-silva','Mateo Silva','Portugal'],
 ['nisha-rao','Nisha Rao','Singapore'],['elias-haddad','Elias Haddad','United Arab Emirates'],
] as const;
export const identities = people.map(([id,name,jurisdiction],i)=>({id,name,jurisdiction,identityRef:`TEST-IDENTITY-${String(i+1).padStart(3,'0')}`,fixtureCase:i===8?'mismatch':i===9?'empty':'match'}));
export const originators = ['Alder Credit Platform','Birch Receivables','Cedar Income Trust','Dune Asset Network','Elm Yield Platform'];
export const firms = ['Northstar Investment Firm','Meridian Investment Firm','Anchor Capital Firm','Bluewater Investment Firm','Pioneer Securities Firm'];
export const positions = [
 ['Alder Private Credit','Term loan note'],['Birch Trade Finance','Receivable note'],
 ['Cedar Income Fund','Fund interest'],['Dune Short Duration','Credit note'],
 ['Elm Infrastructure','Fund interest'],['Alder Growth Credit','Credit note'],
 ['Birch Working Capital','Receivable note'],['Cedar Diversified Income','Fund interest'],
] as const;
export type Manifest = { chainId:number; network?:string; deploymentBlock?:string; rpcUrl:string; asset:Address; registry:Address; settlement:Address; vaults:{id:string;name:string;firm:string;address:Address;manager:Address;termsHash:Hex;termsText:string}[]; originators:{name:string;address:Address}[]; holdings:{id:Hex;profileId:string;name:string;instrument:string;originator:string;originatorAddress:Address;units:string}[] };
export const manifestPath = fileURLToPath(new URL(publicNetwork?'../../../scripts/demo/local/sepolia-manifest.json':'../../../app/public/demo-contracts.json',import.meta.url));
export const fixturePath = fileURLToPath(new URL(publicNetwork?'../../../scripts/demo/local/sepolia-fixture.json':'../../../scripts/demo/local/fixture.json',import.meta.url));
export function manifest():Manifest { const publicPart=JSON.parse(readFileSync(manifestPath,'utf8'));const privatePart=JSON.parse(readFileSync(fixturePath,'utf8'));return {...publicPart,...privatePart} as Manifest; }
export function artifact(name:string):{abi:readonly unknown[];bytecode:{object:Hex}} {
 return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url)),'utf8'));
}
export function err(message:string,code:string,status=400):never { throw Object.assign(new Error(message),{code,status}); }
