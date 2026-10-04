import { expect, type Page } from '@playwright/test';
import { createPublicClient, createWalletClient, hashTypedData, http, isAddress, keccak256, recoverMessageAddress, type Address, type Hex, type TransactionSerializable } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const rpcUrl='http://127.0.0.1:8545';
const chain={id:421614,name:'Lockgate local TEST',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpcUrl]}}} as const;
const mnemonic='test test test test test test test test test test test junk';
const accountAt=(index:number)=>mnemonicToAccount(mnemonic,{addressIndex:index});
const client=createPublicClient({chain,transport:http(rpcUrl)});
export type WalletProof={persona:string;index:number;account:Address;method:string;signature?:Hex;messageHash?:Hex;typedDataHash?:Hex;transactionHash?:Hex;rawHash?:Hex;receiptStatus?:string;blockNumber?:string;from?:Address;to?:Address|null;chainId?:number};
type WalletState={chainId:number;selected:Address;rejectNext:boolean};

export async function assertLocalChain() {
 expect(new URL(rpcUrl).hostname).toBe('127.0.0.1');
 expect(await client.getChainId()).toBe(421614);
 return client;
}

/** The sole browser stub is the EIP-1193 wallet: every signature and transaction is real. */
export async function injectDemoWallet(page:Page,index:number,persona:string,proof:WalletProof[]) {
 const account=accountAt(index),wallet=createWalletClient({account,chain,transport:http(rpcUrl)});
 const state:WalletState={chainId:421614,selected:account.address,rejectNext:false};
 await page.exposeFunction('demoWalletRequest',async(method:string,params:unknown[]=[])=>{
  if(method==='eth_accounts'||method==='eth_requestAccounts')return [state.selected];
  if(method==='eth_chainId')return `0x${state.chainId.toString(16)}`;
  if(method==='wallet_switchEthereumChain'){
   const id=Number(BigInt((params[0] as {chainId:string}).chainId));
   state.chainId=id;return null;
  }
  if(method==='personal_sign'||method==='eth_signTypedData_v4'||method==='eth_sendTransaction'){
   if(state.rejectNext){state.rejectNext=false;return {walletError:true,code:4001,message:'User rejected the request.'};}
   if(state.chainId!==421614)throw new Error('Local wallet refuses signing on the wrong chain.');
   if(state.selected.toLowerCase()!==account.address.toLowerCase())throw new Error('Selected wallet account changed.');
  }
  if(method==='personal_sign'){
   const raw=params[0] as Hex,from=params[1] as Address;
   expect(from.toLowerCase()).toBe(account.address.toLowerCase());
   expect(raw).toMatch(/^0x[0-9a-f]*$/i);
   const signature=await account.signMessage({message:{raw}});
   expect((await recoverMessageAddress({message:{raw},signature})).toLowerCase()).toBe(account.address.toLowerCase());
   proof.push({persona,index,account:account.address,method,signature,messageHash:keccak256(raw)});
   return signature;
  }
  if(method==='eth_signTypedData_v4'){
   const from=params[0] as Address,typed=JSON.parse(params[1] as string);
   expect(from.toLowerCase()).toBe(account.address.toLowerCase());
   expect(Number(typed.domain.chainId)).toBe(421614);
   const signature=await account.signTypedData(typed);
   proof.push({persona,index,account:account.address,method,signature,typedDataHash:hashTypedData(typed)});
   return signature;
  }
  if(method==='eth_sendTransaction'){
   const tx=params[0] as {from:Address;to:Address;data?:Hex;value?:Hex;gas?:Hex};
   expect(tx.from.toLowerCase()).toBe(account.address.toLowerCase());
   expect(isAddress(tx.to)).toBe(true);
   const prepared=await wallet.prepareTransactionRequest({account,to:tx.to,data:tx.data,value:tx.value?BigInt(tx.value):undefined,gas:tx.gas?BigInt(tx.gas):undefined});
   const raw=await account.signTransaction(prepared as TransactionSerializable);
   const hash=await client.sendRawTransaction({serializedTransaction:raw});
   const receipt=await client.waitForTransactionReceipt({hash});
   const actual=await client.getTransaction({hash});
   proof.push({persona,index,account:account.address,method,transactionHash:hash,rawHash:keccak256(raw),receiptStatus:receipt.status,blockNumber:String(receipt.blockNumber),from:actual.from,to:actual.to,chainId:actual.chainId});
   expect(actual.from.toLowerCase()).toBe(account.address.toLowerCase());
   expect(actual.chainId).toBe(421614);
   expect(receipt.status).toBe('success');
   return hash;
  }
  if(/sign|send|impersonate|setBalance|mine/i.test(method))throw new Error(`Wallet method denied: ${method}`);
  const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const data=await response.json();if(data.error)throw new Error(`${method}: ${data.error.message}`);return data.result;
 });
 await page.addInitScript(()=>{
  const listeners:Record<string,((value:unknown)=>void)[]>={};
  Object.assign(window,{ethereum:{request:async({method,params=[]}:{method:string;params?:unknown[]})=>{
   const value=await (window as unknown as {demoWalletRequest:(method:string,params:unknown[])=>Promise<unknown>}).demoWalletRequest(method,params);
   if(value&&typeof value==='object'&&'walletError' in value)throw value;return value;
  },on:(event:string,fn:(value:unknown)=>void)=>{(listeners[event]??=[]).push(fn);},removeListener:(event:string,fn:(value:unknown)=>void)=>{listeners[event]=(listeners[event]||[]).filter(item=>item!==fn);}},demoWalletEmit:(event:string,value:unknown)=>{for(const fn of listeners[event]||[])fn(value);}});
 });
 const setWallet=async(next:Partial<WalletState>)=>{
  Object.assign(state,next);
  await page.evaluate(next=>{
   const emit=(window as unknown as {demoWalletEmit:(event:string,value:unknown)=>void}).demoWalletEmit;
   if(next.chainId)emit('chainChanged',`0x${next.chainId.toString(16)}`);
   if(next.selected)emit('accountsChanged',[next.selected]);
  },next);
 };
 return {account,client,state,setWallet};
}
