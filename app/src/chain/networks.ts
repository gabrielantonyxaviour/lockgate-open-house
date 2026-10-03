import {arbitrum,arbitrumSepolia} from 'viem/chains';
export type NetworkId=421614|42161;
export type SupportedNetworkId=NetworkId;
export const NETWORKS={
 421614:{id:421614,name:'Arbitrum Sepolia',chain:arbitrumSepolia,rpcUrl:arbitrumSepolia.rpcUrls.default.http[0],explorerUrl:arbitrumSepolia.blockExplorers.default.url,testnet:true,contractsAvailable:true},
 42161:{id:42161,name:'Arbitrum One',chain:arbitrum,rpcUrl:arbitrum.rpcUrls.default.http[0],explorerUrl:arbitrum.blockExplorers.default.url,testnet:false,contractsAvailable:false},
} as const;
export const SUPPORTED_NETWORKS=[NETWORKS[421614],NETWORKS[42161]] as const;
export function isSupportedNetwork(id:number):id is SupportedNetworkId{return id===421614||id===42161;}
export function getNetwork(id:number){
 if(!isSupportedNetwork(id))throw new Error('Choose Arbitrum Sepolia or Arbitrum One.');
 return NETWORKS[id];
}
