import { createWalletClient, custom, type Address, type EIP1193Provider } from 'viem';
import { CHAIN } from './config';
import { getNetwork, type SupportedNetworkId } from './networks';
import { addressSchema, checkedAddress } from './client';
declare global { interface Window { ethereum?: EIP1193Provider } }
export function getProvider(): EIP1193Provider {
 if(typeof window === 'undefined' || !window.ethereum) throw new Error('No browser wallet found. Use a wallet-enabled browser.');
 return window.ethereum;
}
export async function connectWallet(): Promise<Address> {
 const accounts = await getProvider().request({method:'eth_requestAccounts'});
 if(!Array.isArray(accounts) || !accounts[0]) throw new Error('The wallet did not provide an account.');
 return checkedAddress(accounts[0]);
}
export async function walletChainId(): Promise<number> {
 const result = await getProvider().request({method:'eth_chainId'});
 if(typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) throw new Error('Invalid wallet network response.');
 const chainId=BigInt(result);
 if(chainId>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Wallet network ID exceeds the safe integer range.');
 return Number(chainId);
}
export function assertWalletChain(chainId:number): void { if(chainId!==CHAIN.id) throw new Error('Switch your wallet to Arbitrum Sepolia before signing.'); }
export async function switchNetwork(id:SupportedNetworkId=421614): Promise<void> {
 const network=getNetwork(id);
 const provider = getProvider();
 const chainId=`0x${id.toString(16)}`;
 const switchRequest={method:'wallet_switchEthereumChain' as const,params:[{chainId}] as [{chainId:string}]};
 try { await provider.request(switchRequest); }
 catch(error) {
  if(!(typeof error==='object' && error && 'code' in error && error.code===4902)) throw error;
  await provider.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:network.name,nativeCurrency:network.chain.nativeCurrency,rpcUrls:[network.rpcUrl],blockExplorerUrls:[network.explorerUrl]}]});
  await provider.request(switchRequest);
 }
 const actual=await walletChainId();
 if(actual!==id) throw new Error(`Your wallet did not switch to ${network.name}. Select it in the wallet and try again.`);
}

export async function authorizedWallet(expected:Address) {
 const provider = getProvider();
 const accounts = await provider.request({method:'eth_accounts'});
 if(!Array.isArray(accounts) || !accounts.some(a=>typeof a==='string' && a.toLowerCase()===expected.toLowerCase())) throw new Error('The selected account is no longer authorized in this wallet.');
 assertWalletChain(await walletChainId());
 return createWalletClient({account:expected,chain:CHAIN,transport:custom(provider)});
}
export function subscribeWallet(onAccounts:(accounts:Address[])=>void,onChain:(chainId:number)=>void):()=>void {
 const provider = getProvider();
 const accounts = (items:unknown) => {
  if(!Array.isArray(items)) {onAccounts([]);return;}
  const parsed=items.map(item=>addressSchema.safeParse(item));
  onAccounts(parsed.every(result=>result.success) ? parsed.map(result=>result.data as Address) : []);
 };
 const chain = (id:unknown) => {
  if(typeof id!=='string' || !/^0x[0-9a-f]+$/i.test(id) || BigInt(id)>BigInt(Number.MAX_SAFE_INTEGER)) {onChain(0);return;}
  onChain(Number(BigInt(id)));
 };
 provider.on('accountsChanged',accounts); provider.on('chainChanged',chain);
 return () => { provider.removeListener('accountsChanged',accounts); provider.removeListener('chainChanged',chain); };
}
