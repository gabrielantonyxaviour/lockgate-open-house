import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, encodeDeployData, formatEther, http, keccak256, parseEther, parseUnits, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { publicSignerAddresses } from './public-signers.js';
import { accountAt, artifact, chain, clientRpcUrl, firms, fixturePath, genesisHash, identities, identityHash, manifestPath, organizationTerms, originators, positions, publicClient, publicNetwork, rpc, terms, vehicleTermsText, walletAt, type Manifest } from './shared.js';

const journalPath=fileURLToPath(new URL('../../../scripts/demo/local/sepolia-bootstrap.json',import.meta.url));
const stepSchema=z.object({hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),from:z.string().optional(),nonce:z.string().optional(),skipped:z.boolean().optional(),contractAddress:z.string().optional(),blockNumber:z.string().optional()});
const journalSchema=z.object({version:z.literal(1),chainId:z.literal(421614),deployer:z.string(),signersHash:z.string(),buildHash:z.string(),initialBalanceWei:z.string(),gasPriceCeilingWei:z.string(),steps:z.record(stepSchema)});
type Journal=z.infer<typeof journalSchema>;
const targets=Array.from({length:16},(_,i)=>parseEther(i===0?'0.008':i<=5?'0.0002':i<=10?'0.0003':'0.00015'));
const localExecutionGas=25_304_847n;
const gasUnitsBudget=2n*(localExecutionGas+16n*21_000n);

function saveJournal(j:Journal){
 mkdirSync(dirname(journalPath),{recursive:true,mode:0o700});
 const temp=`${journalPath}.tmp`;
 writeFileSync(temp,JSON.stringify(j,null,2)+'\n',{mode:0o600});
 renameSync(temp,journalPath);
}

function loadDeployer(){
 const privateKey=process.env.DEPLOYER_PRIVATE_KEY;
 const expected=process.env.DEPLOYER_ADDRESS;
 if(!/^0x[0-9a-fA-F]{64}$/.test(privateKey??'')||!/^0x[0-9a-fA-F]{40}$/.test(expected??''))throw new Error('Funded testnet deployer credentials are missing');
 const account=privateKeyToAccount(privateKey as Hex);
 if(account.address.toLowerCase()!==expected!.toLowerCase())throw new Error('Funded deployer address does not match its key');
 return {account,wallet:createWalletClient({account,chain,transport:http(rpc,{timeout:15000,retryCount:2})})};
}

function buildFingerprint(addresses:Address[]):Hex {
 const bytecodes=['MockUSDG','DemoRegistry','DemoSettlement','DemoFirmVault'].map(name=>keccak256(artifact(name).bytecode.object));
 return keccak256(toHex(JSON.stringify({addresses,bytecodes,terms:firms.map(terms),originators:originators.map(organizationTerms)})));
}

async function preflight(){
 if(!publicNetwork)throw new Error('Public seed requires explicit Arbitrum Sepolia mode');
 const {account:deployer,wallet}=loadDeployer();
 const genesis=await publicClient.getBlock({blockNumber:0n});
 if(await publicClient.getChainId()!==421614||genesis.hash.toLowerCase()!==genesisHash)throw new Error('RPC is not public Arbitrum Sepolia');
 const head=await publicClient.getBlockNumber();
 if(head<1_000_000n)throw new Error('RPC looks like a fresh local chain');
 const signers=publicSignerAddresses(),addresses=signers.map(s=>s.address);
 const [price,balance,...actorBalances]=await Promise.all([
  publicClient.getGasPrice(),publicClient.getBalance({address:deployer.address}),
  ...addresses.map(address=>publicClient.getBalance({address}))
 ]);
 const shortfalls=actorBalances.map((value,i)=>value<targets[i]?targets[i]-value:0n);
 const float=shortfalls.reduce((a,b)=>a+b,0n);
 const ceiling=price*5n/4n,feeUpper=gasUnitsBudget*ceiling,totalUpper=float+feeUpper;
 if(totalUpper>parseEther('0.02')||balance-totalUpper<parseEther('0.06'))throw new Error('Public bootstrap exceeds 0.02 ETH outflow cap or 0.06 ETH deployer floor');
 const token=artifact('MockUSDG'),registry=artifact('DemoRegistry');
 const [tokenGas,registryGas]=await Promise.all([
  publicClient.estimateGas({account:deployer.address,data:encodeDeployData({abi:token.abi as Abi,bytecode:token.bytecode.object,args:[addresses[0]]})}),
  publicClient.estimateGas({account:deployer.address,data:encodeDeployData({abi:registry.abi as Abi,bytecode:registry.bytecode.object,args:[addresses[0],addresses[0]]})})
 ]);
 const signersHash=keccak256(toHex(addresses.join(':'))),buildHash=buildFingerprint(addresses);
 const summary={network:'arbitrum-sepolia',chainId:421614,block:String(head),deployer:deployer.address,admin:addresses[0],signerCount:signers.length,
  gasPriceWei:String(price),gasPriceCeilingWei:String(ceiling),tokenDeployGas:String(tokenGas),registryDeployGas:String(registryGas),gasUnitsBudget:String(gasUnitsBudget),
  gasFeeUpperEth:formatEther(feeUpper),signerFloatEth:formatEther(float),deployerReductionUpperEth:formatEther(totalUpper),deployerBalanceEth:formatEther(balance),deployerBalanceAfterUpperEth:formatEther(balance-totalUpper)};
 return {deployer,wallet,addresses,shortfalls,balance,ceiling,signersHash,buildHash,summary};
}

export async function seedPublicSepolia(execute:boolean){
 const plan=await preflight();
 if(!execute){process.stdout.write(`${JSON.stringify({mode:'preflight',...plan.summary})}\n`);return;}
 if(!['1','true','yes'].includes((process.env.LOCKGATE_ALLOW_SEPOLIA_DEPLOY??'').toLowerCase()))throw new Error('Explicit Sepolia deploy allow flag is missing');
 if(existsSync(manifestPath))throw new Error('Sepolia candidate manifest already exists; verify it instead of redeploying');
 let journal:Journal;
 if(existsSync(journalPath)){
  const parsed=journalSchema.safeParse(JSON.parse(readFileSync(journalPath,'utf8')));
  if(!parsed.success)throw new Error('Existing Sepolia bootstrap journal is invalid');
  journal=parsed.data;
  if(journal.deployer.toLowerCase()!==plan.deployer.address.toLowerCase()||journal.signersHash!==plan.signersHash||journal.buildHash!==plan.buildHash)throw new Error('Existing Sepolia bootstrap does not match signers or bytecode');
  if(BigInt(journal.gasPriceCeilingWei)<BigInt(plan.summary.gasPriceWei))throw new Error('Gas price exceeds original bootstrap ceiling');
 }else{
  journal={version:1,chainId:421614,deployer:plan.deployer.address,signersHash:plan.signersHash,buildHash:plan.buildHash,initialBalanceWei:String(plan.balance),gasPriceCeilingWei:String(plan.ceiling),steps:{}};
  saveJournal(journal);
 }
 const mined=async(id:string,from:Address,send:(nonce:number)=>Promise<Hex>):Promise<TransactionReceipt|undefined>=>{
  let record=journal.steps[id];
  if(record?.skipped)return undefined;
  if(record&&!record.hash)throw new Error(`Sepolia step ${id} has an uncertain broadcast; inspect sender nonce before resuming`);
  if(!record?.hash){
   const current=await publicClient.getGasPrice();
   if(current>BigInt(journal.gasPriceCeilingWei))throw new Error('Gas price exceeded approved bootstrap ceiling');
   const nonce=await publicClient.getTransactionCount({address:from,blockTag:'pending'});
   record={from,nonce:String(nonce)};journal.steps[id]=record;saveJournal(journal);
   for(let attempt=0;attempt<3;attempt++){
    try{record.hash=await send(nonce);saveJournal(journal);break;}
    catch(e){
     const [latest,pending]=await Promise.all([publicClient.getTransactionCount({address:from,blockTag:'latest'}),publicClient.getTransactionCount({address:from,blockTag:'pending'})]);
     if(latest!==nonce||pending!==nonce||attempt===2)throw e;
     await new Promise(resolve=>setTimeout(resolve,1000));
    }
   }
  }
  const receipt=await publicClient.waitForTransactionReceipt({hash:record.hash as Hex,pollingInterval:500,confirmations:3,timeout:120_000});
  if(receipt.status!=='success')throw new Error(`Sepolia step ${id} reverted; inspect journal`);
  if(record.from&&receipt.from.toLowerCase()!==record.from.toLowerCase())throw new Error(`Sepolia step ${id} was mined from an unexpected signer`);
  if(!record.blockNumber||receipt.contractAddress&&!record.contractAddress){
   record.blockNumber=String(receipt.blockNumber);
   if(receipt.contractAddress)record.contractAddress=receipt.contractAddress;
   saveJournal(journal);
  }
  return receipt;
 };
 for(let i=0;i<16;i++){
  const id=`gas.${i}`;
  if(journal.steps[id]){await mined(id,plan.deployer.address,async()=>{throw new Error('Recorded gas transfer cannot be resent');});continue;}
  const balance=await publicClient.getBalance({address:plan.addresses[i]});
  const need=balance<targets[i]?targets[i]-balance:0n;
  if(!need){journal.steps[id]={skipped:true};saveJournal(journal);continue;}
  await mined(id,plan.deployer.address,nonce=>plan.wallet.sendTransaction({to:plan.addresses[i],value:need,nonce}));
 }
 const deploy=async(name:string,args:readonly unknown[]):Promise<{address:Address;block:bigint}>=>{
  const item=artifact(name);
  const receipt=await mined(`deploy.${name}.${name==='DemoFirmVault'?String(args[3]):'base'}`,plan.deployer.address,nonce=>plan.wallet.deployContract({abi:item.abi as Abi,bytecode:item.bytecode.object,args,nonce}));
  if(!receipt?.contractAddress)throw new Error(`${name} deployment address is missing`);
  let visible=false;
  for(let attempt=0;attempt<10;attempt++){
   if(await publicClient.getCode({address:receipt.contractAddress})){visible=true;break;}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!visible)throw new Error(`${name} code not yet visible after mining; resume from checkpoint`);
  return {address:receipt.contractAddress,block:receipt.blockNumber};
 };
 const tx=async(id:string,index:number,address:Address,abi:Abi,functionName:string,args:readonly unknown[])=>{
  await mined(id,accountAt(index).address,nonce=>walletAt(index).writeContract({address,abi,functionName,args,nonce}));
 };
 const tokenAbi=artifact('MockUSDG').abi as Abi,registryAbi=artifact('DemoRegistry').abi as Abi,vaultAbi=artifact('DemoFirmVault').abi as Abi;
 const assetDeployment=await deploy('MockUSDG',[accountAt(0).address]);
 const asset=assetDeployment.address;
 const registry=(await deploy('DemoRegistry',[accountAt(0).address,accountAt(0).address])).address;
 const settlement=(await deploy('DemoSettlement',[registry])).address;
 await tx('registry.configure',0,registry,registryAbi,'configureSettlement',[settlement]);
 const orgs:Manifest['originators']=[];
 for(let i=0;i<5;i++){
  const originator=accountAt(i+1).address,manager=accountAt(i+6).address;
  for(const [address,kind,label,index] of [[originator,1,originators[i],i+1],[manager,2,firms[i],i+6]] as const){
   const accepted=kind===1?organizationTerms(label):terms(label),prefix=`org.${i}.${kind}`;
   await tx(`${prefix}.invite`,0,registry,registryAbi,'inviteOrganization',[address,kind,accepted]);
   await tx(`${prefix}.activate`,index,registry,registryAbi,'activateOrganization',[accepted]);
  }
  await tx(`org.${i}.asset`,0,asset,tokenAbi,'mint',[originator,parseUnits('200000',6)]);
  orgs.push({name:originators[i],address:originator});
 }
 const vaults:Manifest['vaults']=[];
 for(let i=0;i<5;i++){
  const manager=accountAt(i+6).address,termsHash=terms(firms[i]);
  const address=(await deploy('DemoFirmVault',[asset,registry,settlement,manager,termsHash])).address;
  await tx(`vault.${i}.approve`,0,registry,registryAbi,'approveVault',[address]);
  for(let j=0;j<5;j++)await tx(`vault.${i}.mandate.${j}`,i+6,address,vaultAbi,'setMandate',[accountAt(j+1).address,parseUnits('100000',6),parseUnits('100000',6),3]);
  vaults.push({id:`firm-${i+1}`,name:`${firms[i]} Liquidity Vehicle`,firm:firms[i],address,manager,termsHash,termsText:vehicleTermsText(firms[i])});
 }
 for(const p of identities)await tx(`identity.${p.id}`,0,registry,registryAbi,'addTestIdentity',[identityHash(p.identityRef)]);
 const holdings:Manifest['holdings']=[];
 for(let i=0;i<8;i++){
  const p=identities[i],id=identityHash(`TEST-HOLDING-${i+1}`),orgIndex=i%5,routeMask=[3,1,2,1,3][orgIndex];
  await tx(`holding.${i}`,orgIndex+1,registry,registryAbi,'registerHolding',[id,identityHash(p.identityRef),parseUnits('100000',6),routeMask,orgIndex!==1]);
  holdings.push({id,profileId:p.id,name:positions[i][0],instrument:positions[i][1],originator:originators[orgIndex],originatorAddress:accountAt(orgIndex+1).address,units:'100000'});
 }
 for(let i=0;i<5;i++){
  const providerIndex=i+11,provider=accountAt(providerIndex).address,testIdentity=identityHash(`TEST-SEED-PROVIDER-${i+1}`);
  await tx(`provider.${i}.identity`,0,registry,registryAbi,'addTestIdentity',[testIdentity]);
  const validUntil=(await publicClient.getBlock()).timestamp+365n*24n*3600n;
  const signature=await walletAt(0).signTypedData({domain:{name:'LockgateTestIdentity',version:'1',chainId:chain.id,verifyingContract:registry},types:{Identity:[{name:'wallet',type:'address'},{name:'identity',type:'bytes32'},{name:'validUntil',type:'uint64'},{name:'nonce',type:'uint256'}]},primaryType:'Identity',message:{wallet:provider,identity:testIdentity,validUntil,nonce:1n}});
  await tx(`provider.${i}.bind`,providerIndex,registry,registryAbi,'bindIdentity',[testIdentity,validUntil,1n,signature]);
  await tx(`provider.${i}.mint`,0,asset,tokenAbi,'mint',[provider,parseUnits('500000',6)]);
  await tx(`provider.${i}.approve`,providerIndex,asset,tokenAbi,'approve',[vaults[i].address,parseUnits('500000',6)]);
  const deadline=(await publicClient.getBlock()).timestamp+30n*24n*3600n;
  await tx(`provider.${i}.accept`,i+6,vaults[i].address,vaultAbi,'acceptSubscription',[provider,testIdentity,parseUnits('500000',6),deadline]);
  await tx(`provider.${i}.deposit`,providerIndex,vaults[i].address,vaultAbi,'deposit',[1n,vaults[i].termsHash,1n]);
  for(let j=0;j<5;j++)await tx(`provider.${i}.cap.${j}`,i+6,vaults[i].address,vaultAbi,'setExposureCap',[accountAt(j+1).address,2000]);
 }
 const checks=await Promise.all(vaults.map(async v=>({address:v.address,cash:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'idleCash'})),providerCount:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'providerCount'})),capConfigured:await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'capConfigured',args:[orgs[0].address]}),capBps:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'capBps',args:[orgs[0].address]}))})));
 if(checks.some(c=>c.cash!=='500000000000'||c.providerCount!=='1'||c.capConfigured!==true||c.capBps!=='2000'))throw new Error('Sepolia vault balance or cap assertion failed');
 const finalBalance=await publicClient.getBalance({address:plan.deployer.address});
 if(BigInt(journal.initialBalanceWei)-finalBalance>parseEther('0.02')||finalBalance<parseEther('0.06'))throw new Error('Deployer balance crossed public bootstrap budget; inspect journal');
 const out:Manifest={chainId:chain.id,network:'arbitrum-sepolia',deploymentBlock:String(assetDeployment.block),rpcUrl:clientRpcUrl,asset,registry,settlement,vaults,originators:orgs,holdings};
 writeFileSync(manifestPath,JSON.stringify({...out,holdings:undefined},null,2)+'\n',{flag:'wx',mode:0o600});
 writeFileSync(fixturePath,JSON.stringify({holdings},null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write(`${JSON.stringify({mode:'deployed',manifestPath,fixturePath,journalPath,asset,registry,settlement,vaults:vaults.map(v=>({firm:v.firm,address:v.address,manager:v.manager})),originators:orgs,deploymentBlock:out.deploymentBlock,transactions:Object.values(journal.steps).filter(s=>s.hash).length,deployerBalanceAfter:formatEther(finalBalance),vaultChecks:checks})}\n`);
}
