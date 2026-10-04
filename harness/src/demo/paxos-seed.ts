import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, formatEther, http, keccak256, parseEther, parseUnits, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { publicSignerAddresses } from './public-signers.js';
import { accountAt, artifact, chain, clientRpcUrl, firms, fixturePath, genesisHash, identities, identityHash, manifestPath, organizationTerms, originators, paxosMode, paxosTestUsdG, positions, publicClient, rpc, terms, vehicleTermsText, walletAt, type Manifest } from './shared.js';

const journalPath=fileURLToPath(new URL('../../../scripts/demo/local/paxos-usdg-bootstrap.json',import.meta.url));
const erc20Abi=[
 {type:'function',name:'name',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},
 {type:'function',name:'symbol',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},
 {type:'function',name:'decimals',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]},
 {type:'function',name:'balanceOf',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]},
 {type:'function',name:'transfer',stateMutability:'nonpayable',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}]},
 {type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}]}
] as const;
const entrySchema=z.object({hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),from:z.string().optional(),nonce:z.string().optional(),skipped:z.boolean().optional(),blockNumber:z.string().optional()});
const journalSchema=z.object({version:z.literal(1),chainId:z.literal(421614),deployer:z.string(),signersHash:z.string(),buildHash:z.string(),initialBalanceWei:z.string(),gasPriceCeilingWei:z.string(),steps:z.record(entrySchema)});
type Journal=z.infer<typeof journalSchema>;
const seedPerVault=parseUnits('20',6),originatorReserve=parseUnits('4',6);
const gasUnitsBudget=35_000_000n;
const gasTargets=Array.from({length:16},(_,i)=>parseEther(i===0?'0.008':i<=5?'0.0002':i<=10?'0.0003':i===11?'0.0003':'0'));

function persist(j:Journal){
 mkdirSync(dirname(journalPath),{recursive:true,mode:0o700});
 const temp=`${journalPath}.tmp`;
 writeFileSync(temp,JSON.stringify(j,null,2)+'\n',{mode:0o600});
 renameSync(temp,journalPath);
}
function deployerClient(){
 const key=process.env.DEPLOYER_PRIVATE_KEY,expected=process.env.DEPLOYER_ADDRESS;
 if(!/^0x[0-9a-fA-F]{64}$/.test(key??'')||!/^0x[0-9a-fA-F]{40}$/.test(expected??''))throw new Error('Funded Sepolia deployer credentials are missing');
 const account=privateKeyToAccount(key as Hex);
 if(account.address.toLowerCase()!==expected!.toLowerCase())throw new Error('Sepolia deployer address does not match its key');
 return {account,wallet:createWalletClient({account,chain,transport:http(rpc,{timeout:15_000,retryCount:2})})};
}
function fingerprint(addresses:Address[],tokenCode:Hex):Hex{
 const bytecodes=['DemoRegistry','DemoSettlement','DemoFirmVault'].map(name=>keccak256(artifact(name).bytecode.object));
 return keccak256(toHex(JSON.stringify({addresses,bytecodes,token:paxosTestUsdG,tokenCodeHash:keccak256(tokenCode),terms:firms.map(terms),seedPerVault:String(seedPerVault),originatorReserve:String(originatorReserve)})));
}
async function preflight(){
 if(!paxosMode)throw new Error('Explicit LOCKGATE_DEMO_ASSET=paxos-usdg on Arbitrum Sepolia is required');
 const {account:deployer,wallet}=deployerClient();
 const [chainId,genesis,head,price,code]=await Promise.all([publicClient.getChainId(),publicClient.getBlock({blockNumber:0n}),publicClient.getBlockNumber(),publicClient.getGasPrice(),publicClient.getCode({address:paxosTestUsdG})]);
 if(chainId!==421614||genesis.hash.toLowerCase()!==genesisHash||head<1_000_000n)throw new Error('RPC is not public Arbitrum Sepolia');
 if(!code)throw new Error('Official Paxos test USDG code missing');
 const [name,symbol,decimals]=await Promise.all([
  publicClient.readContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'name'}),
  publicClient.readContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'symbol'}),
  publicClient.readContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'decimals'})
 ]);
 if(name!=='Global Dollar'||symbol!=='USDG'||decimals!==6)throw new Error('Official Paxos test USDG metadata mismatch');
 const addresses=publicSignerAddresses().map(s=>s.address);
 if(addresses.length<16)throw new Error('Sixteen public demo signers are required');
 const approval=await publicClient.simulateContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'approve',args:[addresses[6],seedPerVault],account:addresses[11]});
 if(approval.result!==true)throw new Error('Official token approval simulation did not succeed');
 const [deployerBalance,...actorBalances]=await Promise.all([publicClient.getBalance({address:deployer.address}),...addresses.map(address=>publicClient.getBalance({address}))]);
 const [providerUsdG,originatorUsdG]=await Promise.all([
  publicClient.readContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'balanceOf',args:[addresses[11]]}),
  publicClient.readContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'balanceOf',args:[addresses[1]]})
 ]);
 const shortages=actorBalances.map((balance,i)=>balance<gasTargets[i]?gasTargets[i]-balance:0n);
 const gasFloat=shortages.reduce((a,b)=>a+b,0n),ceiling=price*3n/2n,upperGas=gasUnitsBudget*ceiling,totalUpper=gasFloat+upperGas;
 const budgetOk=totalUpper<=parseEther('0.02')&&deployerBalance>=totalUpper+parseEther('0.06');
 const fundingOk=providerUsdG>=5n*seedPerVault&&originatorUsdG>=5n*originatorReserve;
 const summary={network:'Arbitrum Sepolia',asset:paxosTestUsdG,decimals,approvalSimulation:true,block:String(head),candidatePresent:existsSync(manifestPath),seedProvider:addresses[11],originatorFundingSource:addresses[1],providerUsdG:String(providerUsdG),providerRequired:String(5n*seedPerVault),originatorUsdG:String(originatorUsdG),originatorRequired:String(5n*originatorReserve),gasPriceWei:String(price),gasPriceCeilingWei:String(ceiling),gasUnitsBudget:String(gasUnitsBudget),gasFeeUpperEth:formatEther(upperGas),gasFloatEth:formatEther(gasFloat),deployerEth:formatEther(deployerBalance),deployerAfterUpperEth:formatEther(deployerBalance-totalUpper),budgetOk,fundingOk,ready:budgetOk&&fundingOk&&!existsSync(manifestPath)};
 return {summary,deployer,wallet,addresses,shortages,ceiling,signersHash:keccak256(toHex(addresses.join(':'))),buildHash:fingerprint(addresses,code)};
}

export async function migratePaxosSepolia(execute:boolean){
 const plan=await preflight();
 if(!execute){process.stdout.write(`${JSON.stringify({mode:'read-only-preflight',...plan.summary})}\n`);return;}
 if(process.env.LOCKGATE_ALLOW_PAXOS_MIGRATION!=='1')throw new Error('Explicit Paxos migration execution flag is missing');
 if(plan.summary.candidatePresent)throw new Error('Paxos candidate manifest already exists; verify it instead of redeploying');
 if(!plan.summary.budgetOk)throw new Error('Paxos migration exceeds approved 0.02 ETH outflow or 0.06 ETH deployer floor');
 let journal:Journal;
 if(existsSync(journalPath)){
  const parsed=journalSchema.safeParse(JSON.parse(readFileSync(journalPath,'utf8')));
  if(!parsed.success)throw new Error('Existing Paxos migration journal is invalid');
  journal=parsed.data;
  if(journal.deployer.toLowerCase()!==plan.deployer.address.toLowerCase()||journal.signersHash!==plan.signersHash||journal.buildHash!==plan.buildHash)throw new Error('Existing migration does not match signers, asset, terms or bytecode');
  if(BigInt(journal.gasPriceCeilingWei)<BigInt(plan.summary.gasPriceWei))throw new Error('Gas price exceeds migration ceiling');
 }else{
  if(!plan.summary.fundingOk)throw new Error('Official Paxos test USDG funding is not yet present in the two authorized fixture wallets');
  journal={version:1,chainId:421614,deployer:plan.deployer.address,signersHash:plan.signersHash,buildHash:plan.buildHash,initialBalanceWei:String(await publicClient.getBalance({address:plan.deployer.address})),gasPriceCeilingWei:String(plan.ceiling),steps:{}};
  persist(journal);
 }
 const mined=async(id:string,from:Address,send:(nonce:number)=>Promise<Hex>):Promise<TransactionReceipt|undefined>=>{
  let record=journal.steps[id];
  if(record?.skipped)return undefined;
  if(record&&!record.hash)throw new Error(`Uncertain broadcast at ${id}; reconcile sender nonce before resuming`);
  if(!record){
   if(await publicClient.getGasPrice()>BigInt(journal.gasPriceCeilingWei))throw new Error('Gas price exceeded approved migration ceiling');
   const nonce=await publicClient.getTransactionCount({address:from,blockTag:'pending'});
   record={from,nonce:String(nonce)};journal.steps[id]=record;persist(journal);
   record.hash=await send(nonce);persist(journal);
  }
  const receipt=await publicClient.waitForTransactionReceipt({hash:record.hash as Hex,pollingInterval:500,confirmations:3,timeout:120_000});
  if(receipt.status!=='success'||receipt.from.toLowerCase()!==from.toLowerCase())throw new Error(`Migration step ${id} failed or signer changed`);
  if(!record.blockNumber){record.blockNumber=String(receipt.blockNumber);persist(journal);}
  return receipt;
 };
 for(let i=0;i<12;i++){
  const id=`gas.${i}`;
  if(journal.steps[id]){await mined(id,plan.deployer.address,async()=>{throw new Error('Recorded gas transfer cannot be resent');});continue;}
  const balance=await publicClient.getBalance({address:plan.addresses[i]});
  const need=balance<gasTargets[i]?gasTargets[i]-balance:0n;
  if(!need){journal.steps[id]={skipped:true};persist(journal);continue;}
  await mined(id,plan.deployer.address,nonce=>plan.wallet.sendTransaction({to:plan.addresses[i],value:need,nonce}));
 }
 const deploy=async(id:string,name:string,args:readonly unknown[]):Promise<{address:Address;block:bigint}>=>{
  const item=artifact(name);
  const receipt=await mined(id,plan.deployer.address,nonce=>plan.wallet.deployContract({abi:item.abi as Abi,bytecode:item.bytecode.object,args,nonce}));
  if(!receipt?.contractAddress)throw new Error(`${id} deployment address is missing`);
  for(let attempt=0;attempt<12;attempt++){
   if(await publicClient.getCode({address:receipt.contractAddress}))return {address:receipt.contractAddress,block:receipt.blockNumber};
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`${id} code not visible after receipt; resume from checkpoint`);
 };
 const tx=async(id:string,index:number,address:Address,abi:Abi,functionName:string,args:readonly unknown[])=>{
  await mined(id,accountAt(index).address,nonce=>walletAt(index).writeContract({address,abi,functionName,args,nonce}));
 };
 const registryAbi=artifact('DemoRegistry').abi as Abi,settlementAbi=artifact('DemoSettlement').abi as Abi,vaultAbi=artifact('DemoFirmVault').abi as Abi;
 const registryDeployment=await deploy('deploy.registry','DemoRegistry',[accountAt(0).address,accountAt(0).address]);
 const registry=registryDeployment.address;
 const settlement=(await deploy('deploy.settlement','DemoSettlement',[registry])).address;
 await tx('registry.configure',0,registry,registryAbi,'configureSettlement',[settlement]);
 const orgs:Manifest['originators']=[];
 for(let i=0;i<5;i++){
  const originator=accountAt(i+1).address,manager=accountAt(i+6).address;
  for(const [address,kind,label,index] of [[originator,1,originators[i],i+1],[manager,2,firms[i],i+6]] as const){
   const accepted=kind===1?organizationTerms(label):terms(label),id=`org.${i}.${kind}`;
   await tx(`${id}.invite`,0,registry,registryAbi,'inviteOrganization',[address,kind,accepted]);
   await tx(`${id}.activate`,index,registry,registryAbi,'activateOrganization',[accepted]);
  }
  orgs.push({name:originators[i],address:originator});
 }
 const vaults:Manifest['vaults']=[];
 for(let i=0;i<5;i++){
  const manager=accountAt(i+6).address,termsHash=terms(firms[i]);
  const address=(await deploy(`deploy.vault.${i}`,'DemoFirmVault',[paxosTestUsdG,registry,settlement,manager,termsHash])).address;
  await tx(`vault.${i}.approve`,0,registry,registryAbi,'approveVault',[address]);
  for(let j=0;j<5;j++){
   await tx(`vault.${i}.mandate.${j}`,i+6,address,vaultAbi,'setMandate',[accountAt(j+1).address,originatorReserve,originatorReserve,3]);
   await tx(`vault.${i}.cap.${j}`,i+6,address,vaultAbi,'setExposureCap',[accountAt(j+1).address,2000]);
  }
  vaults.push({id:`firm-${i+1}`,name:`${firms[i]} Liquidity Vehicle`,firm:firms[i],address,manager,termsHash,termsText:vehicleTermsText(firms[i])});
 }
 for(const p of identities)await tx(`identity.${p.id}`,0,registry,registryAbi,'addTestIdentity',[identityHash(p.identityRef)]);
 const holdings:Manifest['holdings']=[];
 for(let i=0;i<8;i++){
  const p=identities[i],id=identityHash(`PAXOS-TEST-HOLDING-${i+1}`),orgIndex=i%5,routeMask=[3,1,2,1,3][orgIndex];
  await tx(`holding.${i}`,orgIndex+1,registry,registryAbi,'registerHolding',[id,identityHash(p.identityRef),parseUnits('3',6),routeMask,orgIndex!==1]);
  holdings.push({id,profileId:p.id,name:positions[i][0],instrument:positions[i][1],originator:originators[orgIndex],originatorAddress:accountAt(orgIndex+1).address,units:'3'});
 }
 const provider=accountAt(11).address,testIdentity=identityHash('PAXOS-TEST-SEED-PROVIDER-1');
 await tx('provider.identity',0,registry,registryAbi,'addTestIdentity',[testIdentity]);
 const validUntil=(await publicClient.getBlock()).timestamp+365n*24n*3600n;
 const signature=await walletAt(0).signTypedData({domain:{name:'LockgateTestIdentity',version:'1',chainId:chain.id,verifyingContract:registry},types:{Identity:[{name:'wallet',type:'address'},{name:'identity',type:'bytes32'},{name:'validUntil',type:'uint64'},{name:'nonce',type:'uint256'}]},primaryType:'Identity',message:{wallet:provider,identity:testIdentity,validUntil,nonce:1n}});
 await tx('provider.bind',11,registry,registryAbi,'bindIdentity',[testIdentity,validUntil,1n,signature]);
 for(let i=1;i<5;i++)await tx(`originator.fund.${i}`,1,paxosTestUsdG,erc20Abi as Abi,'transfer',[accountAt(i+1).address,originatorReserve]);
 for(let i=0;i<5;i++){
  await tx(`provider.${i}.approve`,11,paxosTestUsdG,erc20Abi as Abi,'approve',[vaults[i].address,seedPerVault]);
  const deadline=(await publicClient.getBlock()).timestamp+30n*24n*3600n;
  await tx(`provider.${i}.accept`,i+6,vaults[i].address,vaultAbi,'acceptSubscription',[provider,testIdentity,seedPerVault,deadline]);
  await tx(`provider.${i}.deposit`,11,vaults[i].address,vaultAbi,'deposit',[1n,vaults[i].termsHash,seedPerVault]);
 }
 const checks=await Promise.all(vaults.map(async v=>({address:v.address,asset:await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'asset'}),cash:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'idleCash'})),providerCount:String(await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'providerCount'})),caps:await Promise.all(orgs.map(o=>publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'capBps',args:[o.address]}))),active:await publicClient.readContract({address:registry,abi:registryAbi,functionName:'isActive',args:[v.manager,2]})})));
 const orgChecks=await Promise.all(orgs.map(async o=>({address:o.address,active:await publicClient.readContract({address:registry,abi:registryAbi,functionName:'isActive',args:[o.address,1]}),usdg:String(await publicClient.readContract({address:paxosTestUsdG,abi:erc20Abi,functionName:'balanceOf',args:[o.address]}))})));
 if(checks.some(c=>String(c.asset).toLowerCase()!==paxosTestUsdG.toLowerCase()||c.cash!==String(seedPerVault)||c.providerCount!=='1'||c.active!==true||c.caps.some(bps=>Number(bps)!==2000))||orgChecks.some(c=>c.active!==true||BigInt(c.usdg)<originatorReserve))throw new Error('Paxos vault funding, organization or risk cap assertion failed');
 const finalBalance=await publicClient.getBalance({address:plan.deployer.address});
 if(BigInt(journal.initialBalanceWei)-finalBalance>parseEther('0.02')||finalBalance<parseEther('0.06'))throw new Error('Deployer crossed approved ETH budget; inspect migration journal');
 const out:Manifest={chainId:chain.id,network:'arbitrum-sepolia',deploymentBlock:String(registryDeployment.block),rpcUrl:clientRpcUrl,asset:paxosTestUsdG,registry,settlement,vaults,originators:orgs,holdings};
 writeFileSync(manifestPath,JSON.stringify({...out,holdings:undefined},null,2)+'\n',{flag:'wx',mode:0o600});
 writeFileSync(fixturePath,JSON.stringify({holdings},null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write(`${JSON.stringify({mode:'paxos-candidate-ready',asset:paxosTestUsdG,registry,settlement,vaults:checks,originators:orgChecks,deploymentBlock:out.deploymentBlock,transactionCount:Object.values(journal.steps).filter(s=>s.hash).length,deployerEthAfter:formatEther(finalBalance),manifestPath,fixturePath,journalPath})}\n`);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 migratePaxosSepolia(process.argv[2]==='--execute').catch(error=>{
  process.stderr.write(`${String(error?.shortMessage??error?.message??error).split('http')[0]}\n`);
  process.exitCode=1;
 });
}
