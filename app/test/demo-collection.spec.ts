import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPublicClient,formatUnits,http,keccak256,parseAbi,parseEventLogs,parseUnits,toHex,type Address} from 'viem';
import {accountAt,injectDemoWallet,type WalletProof} from './demo-wallet';
import {captureWidths,copyVideo,evidenceDir,hashFile,prepareProof,saveProof,until} from './demo-proof';

const settlementEvents=parseAbi(['event Settled(bytes32 indexed digest,address indexed investor,uint8 route,uint256 units,uint256 payout,uint256 repayment)','event Repaid(bytes32 indexed digest,address indexed payer,uint256 amount,uint256 remaining)']);
const settlementAbi=parseAbi(['function purchasedUnits(bytes32,address) view returns (uint256)','function collectedUnits(bytes32,address) view returns (uint256)']);
const vaultAbi=parseAbi(['function outstandingPrincipal() view returns (uint256)','function totalAssets() view returns (uint256)','function idleCash() view returns (uint256)']);
const tokenAbi=parseAbi(['function balanceOf(address) view returns (uint256)']);
const registryEvent=parseAbi(['event HoldingRegistered(bytes32 indexed id,address indexed originator,bytes32 indexed identity,uint256 units)']);

test('originator collects purchased route-A claim and provider earns actual TEST spread',async({browser})=>{
 test.skip(process.env.LOCKGATE_DEMO_COLLECTION!=='1','Run after main four-persona E2E on the same local chain.');
 test.setTimeout(180_000);await prepareProof();
 const m=JSON.parse(await readFile(resolve('public/demo-contracts.json'),'utf8')) as {registry:Address;settlement:Address;asset:Address;vaults:{address:Address}[]};
 const chain=createPublicClient({transport:http('http://127.0.0.1:8545')});expect(await chain.getChainId()).toBe(421614);
 const settlements=parseEventLogs({abi:settlementEvents,eventName:'Settled',logs:await chain.getLogs({address:m.settlement,fromBlock:0n})});
 const a=settlements.find(item=>item.args.route===1&&item.args.units===parseUnits('40000',6));expect(a).toBeDefined();
 const digest=a!.args.digest;
 const holdings=parseEventLogs({abi:registryEvent,eventName:'HoldingRegistered',logs:await chain.getLogs({address:m.registry,fromBlock:0n})});
 const holdingId=holdings.find(item=>item.args.identity===keccak256(toHex('TEST-IDENTITY-001')))?.args.id;expect(holdingId).toBeDefined();
 const proof:WalletProof[]=[],checks:unknown[]=[],screenshots:unknown[]=[],videos:unknown[]=[];
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5197',viewport:{width:1440,height:900},recordVideo:{dir:evidenceDir,size:{width:1440,height:900}}});
 context.setDefaultTimeout(20_000);
 const page=await context.newPage(),wallet=await injectDemoWallet(page,1,'originator-collection',proof);
 let phase='find purchased claim',failure:string|undefined;
 try{
  const provider=accountAt(11);
  const income=async()=>{const challenge=await (await page.request.post('/api/demo/challenge',{data:{account:provider.address,chainId:421614}})).json();const signature=await provider.signMessage({message:challenge.message});const authenticated=await (await page.request.post('/api/demo/authenticate',{data:{account:provider.address,chainId:421614,message:challenge.message,nonce:challenge.nonce,signature}})).json();return Number(authenticated.state.vehicles[0].income);};
  const providerIncomeBefore=await income();
  const vault=m.vaults[0].address;
  const beforePurchased=await chain.readContract({address:m.settlement,abi:settlementAbi,functionName:'purchasedUnits',args:[holdingId!,vault]});
  const beforeCollected=await chain.readContract({address:m.settlement,abi:settlementAbi,functionName:'collectedUnits',args:[holdingId!,vault]});
  const beforePrincipal=await chain.readContract({address:vault,abi:vaultAbi,functionName:'outstandingPrincipal'});
  const beforeAssets=await chain.readContract({address:vault,abi:vaultAbi,functionName:'totalAssets'});
  const beforeCash=await chain.readContract({address:vault,abi:vaultAbi,functionName:'idleCash'});
  const beforeBalance=await chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]});
  expect(beforePurchased).toBe(parseUnits('40000',6));expect(beforeCollected).toBe(0n);
  phase='originator wallet collects claim';
  await page.goto('/');await page.getByRole('button',{name:/Connect wallet/}).click();
  await expect(page.getByRole('heading',{name:'Originator workspace'})).toBeVisible();
  await page.getByRole('button',{name:'Repay a financed exit'}).click();
  await page.getByRole('combobox',{name:'Exit obligation'}).click();await page.getByRole('option',{name:/Purchase/}).click();
  await page.getByRole('button',{name:'Review action'}).click();
  await page.getByRole('button',{name:'Confirm in wallet'}).click();
  await expect(page.getByRole('heading',{name:'Originator workspace'})).toBeVisible();
  const afterBalance=await until(()=>chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]}),value=>beforeBalance-value===parseUnits('40000',6));
  const repayHash=proof.filter(p=>p.transactionHash).at(-1)?.transactionHash;expect(repayHash).toBeDefined();
  const receipt=await chain.getTransactionReceipt({hash:repayHash!});expect(receipt.status).toBe('success');
  const repaid=parseEventLogs({abi:settlementEvents,eventName:'Repaid',logs:receipt.logs});expect(repaid).toHaveLength(1);
  expect(repaid[0].args.digest).toBe(digest);expect(repaid[0].args.amount).toBe(parseUnits('40000',6));expect(repaid[0].args.remaining).toBe(0n);
  const afterPurchased=await chain.readContract({address:m.settlement,abi:settlementAbi,functionName:'purchasedUnits',args:[holdingId!,vault]});
  const afterCollected=await chain.readContract({address:m.settlement,abi:settlementAbi,functionName:'collectedUnits',args:[holdingId!,vault]});
  const afterPrincipal=await chain.readContract({address:vault,abi:vaultAbi,functionName:'outstandingPrincipal'});
  const afterAssets=await chain.readContract({address:vault,abi:vaultAbi,functionName:'totalAssets'});
  const afterCash=await chain.readContract({address:vault,abi:vaultAbi,functionName:'idleCash'});
  const providerIncomeAfter=await income();expect(providerIncomeAfter).toBeGreaterThan(providerIncomeBefore);
  expect(afterPurchased).toBe(0n);expect(afterCollected).toBe(parseUnits('40000',6));
  expect(beforePrincipal-afterPrincipal).toBe(parseUnits('39200',6));
  expect(afterAssets-beforeAssets).toBe(parseUnits('800',6));
  expect(afterCash-beforeCash).toBe(parseUnits('40000',6));
  expect(beforeBalance-afterBalance).toBe(parseUnits('40000',6));
  checks.push({holdingId,digest,vault,repayHash,originator:wallet.account.address,receiptBlock:String(receipt.blockNumber),purchasedBefore:formatUnits(beforePurchased,6),purchasedAfter:formatUnits(afterPurchased,6),collectedBefore:formatUnits(beforeCollected,6),collectedAfter:formatUnits(afterCollected,6),principalBefore:formatUnits(beforePrincipal,6),principalAfter:formatUnits(afterPrincipal,6),assetsBefore:formatUnits(beforeAssets,6),assetsAfter:formatUnits(afterAssets,6),earnedSpread:formatUnits(afterAssets-beforeAssets,6),providerIncomeBefore,providerIncomeAfter,originatorBalanceBefore:formatUnits(beforeBalance,6),originatorBalanceAfter:formatUnits(afterBalance,6)});
  screenshots.push(...await captureWidths(page,'originator','collection'));
 }catch(error){failure=error instanceof Error?error.stack??error.message:String(error);throw error;}
 finally{const video=page.video();await context.close();const source=await video?.path();if(source)videos.push(await copyVideo(source,'originator-collection'));await saveProof('collection-evidence.json',{environment:'LOCAL ANVIL TEST ONLY; six-decimal MockUSDG',phase,failure,checks,walletProof:proof,screenshots,videos,sourceHashes:{test:await hashFile(resolve('test/demo-collection.spec.ts')),manifest:await hashFile(resolve('public/demo-contracts.json'))}});}
});
