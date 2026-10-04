import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseUnits, parseEther, type Abi, type Address, type Hex } from 'viem';
import { accountAt, artifact, chain, firms, identities, identityHash, manifestPath, fixturePath, organizationTerms, originators, positions, publicClient, publicNetwork, rpc, terms, vehicleTermsText, walletAt, type Manifest } from './shared.js';
import { seedPublicSepolia } from './public-seed.js';

async function main() {
 if(publicNetwork){await seedPublicSepolia(process.argv.includes('--execute'));return;}
 if (await publicClient.getChainId() !== chain.id) throw new Error('Refusing non-local or wrong-chain RPC');
 const head = await publicClient.getBlockNumber();
 if (head !== 0n) throw new Error('Seed requires a fresh local Anvil chain; existing state is preserved');
 const admin = walletAt(0);
 const deploy = async(name:string,args:readonly unknown[]):Promise<Address> => {
  const a=artifact(name);
  const hash=await admin.deployContract({abi:a.abi as Abi,bytecode:a.bytecode.object,args});
  const r=await publicClient.waitForTransactionReceipt({hash});
  if(r.status!=='success'||!r.contractAddress) throw new Error(`${name} deploy failed`);
  return r.contractAddress;
 };
 const tx=async(index:number,address:Address,abi:Abi,functionName:string,args:readonly unknown[])=>{
  const hash=await walletAt(index).writeContract({address,abi,functionName,args});
  const r=await publicClient.waitForTransactionReceipt({hash});
  if(r.status!=='success') throw new Error(`${functionName} failed`);
  return r;
 };
 const tokenAbi=artifact('MockUSDG').abi as Abi;
 const registryAbi=artifact('DemoRegistry').abi as Abi;
 const vaultAbi=artifact('DemoFirmVault').abi as Abi;
 const asset=await deploy('MockUSDG',[accountAt(0).address]);
 const registry=await deploy('DemoRegistry',[accountAt(0).address,accountAt(0).address]);
 const settlement=await deploy('DemoSettlement',[registry]);
 await tx(0,registry,registryAbi,'configureSettlement',[settlement]);
 for(let i=1;i<=30;i++) {
  const hash=await admin.sendTransaction({to:accountAt(i).address,value:parseEther('1')});
  if((await publicClient.waitForTransactionReceipt({hash})).status!=='success') throw new Error('gas funding failed');
 }
 const orgs:Manifest['originators']=[];
 for(let i=0;i<5;i++) {
  const originator=accountAt(i+1).address;
  const manager=accountAt(i+6).address;
  for(const [address,kind,label,index] of [[originator,1,originators[i],i+1],[manager,2,firms[i],i+6]] as const) {
   const accepted=kind===1?organizationTerms(label):terms(label);
   await tx(0,registry,registryAbi,'inviteOrganization',[address,kind,accepted]);
   await tx(index,registry,registryAbi,'activateOrganization',[accepted]);
  }
  await tx(0,asset,tokenAbi,'mint',[originator,parseUnits('200000',6)]);
  orgs.push({name:originators[i],address:originator});
 }
 const vaults:Manifest['vaults']=[];
 for(let i=0;i<5;i++) {
  const manager=accountAt(i+6).address;
  const termsHash=terms(firms[i]);
  const address=await deploy('DemoFirmVault',[asset,registry,settlement,manager,termsHash]);
  await tx(0,registry,registryAbi,'approveVault',[address]);
  for(let j=0;j<5;j++) await tx(i+6,address,vaultAbi,'setMandate',[accountAt(j+1).address,parseUnits('100000',6),parseUnits('100000',6),3]);
  vaults.push({id:`firm-${i+1}`,name:`${firms[i]} Liquidity Vehicle`,firm:firms[i],address,manager,termsHash,termsText:vehicleTermsText(firms[i])});
 }
 for(const p of identities) await tx(0,registry,registryAbi,'addTestIdentity',[identityHash(p.identityRef)]);
 const holdings:Manifest['holdings']=[];
 for(let i=0;i<8;i++) {
  const p=identities[i];
  const id=identityHash(`TEST-HOLDING-${i+1}`);
  const orgIndex=i%5;
  const routeMask=[3,1,2,1,3][orgIndex];
  await tx(orgIndex+1,registry,registryAbi,'registerHolding',[id,identityHash(p.identityRef),parseUnits('100000',6),routeMask,orgIndex!==1]);
  holdings.push({id,profileId:p.id,name:positions[i][0],instrument:positions[i][1],originator:originators[orgIndex],originatorAddress:accountAt(orgIndex+1).address,units:'100000'});
 }
 for(let i=0;i<5;i++) {
  const providerIndex=i+11;
  const provider=accountAt(providerIndex).address;
  const testIdentity=identityHash(`TEST-SEED-PROVIDER-${i+1}`);
  await tx(0,registry,registryAbi,'addTestIdentity',[testIdentity]);
  const validUntil=BigInt(Math.floor(Date.now()/1000)+365*24*3600);
  const signature=await walletAt(0).signTypedData({domain:{name:'LockgateTestIdentity',version:'1',chainId:chain.id,verifyingContract:registry},types:{Identity:[{name:'wallet',type:'address'},{name:'identity',type:'bytes32'},{name:'validUntil',type:'uint64'},{name:'nonce',type:'uint256'}]},primaryType:'Identity',message:{wallet:provider,identity:testIdentity,validUntil,nonce:1n}});
  await tx(providerIndex,registry,registryAbi,'bindIdentity',[testIdentity,validUntil,1n,signature]);
  await tx(0,asset,tokenAbi,'mint',[provider,parseUnits('500000',6)]);
  await tx(providerIndex,asset,tokenAbi,'approve',[vaults[i].address,parseUnits('500000',6)]);
  const deadline=BigInt(Math.floor(Date.now()/1000)+30*24*3600);
  await tx(i+6,vaults[i].address,vaultAbi,'acceptSubscription',[provider,testIdentity,parseUnits('500000',6),deadline]);
  await tx(providerIndex,vaults[i].address,vaultAbi,'deposit',[1n,vaults[i].termsHash,1n]);
  for(let j=0;j<5;j++) await tx(i+6,vaults[i].address,vaultAbi,'setExposureCap',[accountAt(j+1).address,2000]);
 }
 const out:Manifest={chainId:chain.id,rpcUrl:rpc,asset,registry,settlement,vaults,originators:orgs,holdings};
 mkdirSync(dirname(manifestPath),{recursive:true});
 writeFileSync(manifestPath,JSON.stringify({...out,holdings:undefined},null,2)+'\n');
 mkdirSync(dirname(fixturePath),{recursive:true});
 writeFileSync(fixturePath,JSON.stringify({holdings},null,2)+'\n',{mode:0o600});
 const checks=await Promise.all(vaults.map(async v=>({address:v.address,cash:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'idleCash'})),providerCount:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'providerCount'})),capConfigured:await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'capConfigured',args:[orgs[0].address]}),capBps:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'capBps',args:[orgs[0].address]}))})));
 if(checks.some(c=>c.cash!=='500000000000'||c.providerCount!=='1'||c.capConfigured!==true||c.capBps!=='2000'))throw new Error('Seeded vault balance or cap assertion failed');
 process.stdout.write(`${JSON.stringify({chainId:chain.id,asset,registry,settlement,originators:orgs.length,firms:vaults.length,holdings:holdings.length,vaultChecks:checks})}\n`);
}
main().catch(e=>{
 if(publicNetwork){
  const detail=typeof e?.shortMessage==='string'?e.shortMessage.replaceAll(rpc,'[private RPC]').replace(/https?:\/\/\S+/g,'[private RPC]').replace(/0x[0-9a-fA-F]{64}/g,'[hex]').slice(0,180):'';
  process.stderr.write(`Sepolia bootstrap failed (${e instanceof Error?e.name:'unknown'}): ${detail||'inspect private journal and preflight'}\n`);
 }else process.stderr.write(`${e instanceof Error?e.message:'seed failed'}\n`);
 process.exitCode=1;
});
