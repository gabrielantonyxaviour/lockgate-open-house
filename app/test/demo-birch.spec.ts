import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPublicClient,http,keccak256,parseAbi,parseEventLogs,toHex,type Address} from 'viem';
import {injectDemoWallet,type WalletProof} from './demo-wallet';
import {captureWidths,copyVideo,evidenceDir,hashFile,prepareProof,saveProof} from './demo-proof';

const events=parseAbi(['event HoldingRegistered(bytes32 indexed id,address indexed originator,bytes32 indexed identity,uint256 units)','event Reserved(bytes32 indexed digest,bytes32 indexed holding,address indexed vault,uint256 payout,uint64 deadline)','event Cancelled(bytes32 indexed digest)','event Settled(bytes32 indexed digest,address indexed investor,uint8 route,uint256 units,uint256 payout,uint256 repayment)']);
const tokenAbi=parseAbi(['function balanceOf(address) view returns (uint256)']);
const registryAbi=parseAbi(['function holding(bytes32) view returns (address,bytes32,uint256 remaining,uint256 locked,uint8,bool)']);

test('indivisible Birch TEST claim changes reserved bid and settles full exit',async({browser})=>{
 test.skip(process.env.LOCKGATE_DEMO_BIRCH!=='1','Run after main demo E2E on the same local chain.');
 test.setTimeout(180_000);
 await prepareProof();
 const m=JSON.parse(await readFile(resolve('public/demo-contracts.json'),'utf8')) as {registry:Address;settlement:Address;asset:Address};
 const chain=createPublicClient({transport:http('http://127.0.0.1:8545')});
 const proof:WalletProof[]=[],checks:unknown[]=[],videos:unknown[]=[],screenshots:unknown[]=[];
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5197',viewport:{width:1440,height:900},recordVideo:{dir:evidenceDir,size:{width:1440,height:900}}});
 context.setDefaultTimeout(20_000);
 const page=await context.newPage(),wallet=await injectDemoWallet(page,14,'birch-full-claim',proof);
 let failure:string|undefined,phase='connect';
 try{
  const registered=parseEventLogs({abi:events,eventName:'HoldingRegistered',logs:await chain.getLogs({address:m.registry,fromBlock:0n})});
  const id=registered.find(item=>item.args.identity===keccak256(toHex('TEST-IDENTITY-007')))?.args.id;
  expect(id).toBeDefined();
  const original=await chain.readContract({address:m.registry,abi:registryAbi,functionName:'holding',args:[id!]});
  expect(original[2]).toBe(100_000_000_000n);expect(original[5]).toBe(false);
  await page.goto('/');await page.getByRole('button',{name:/Connect wallet/}).click();
  await page.getByRole('button',{name:/Get Started — Exit investor/}).click();
  await expect(page.getByRole('button',{name:'Start KYC'})).toBeVisible();
  await page.getByRole('button',{name:'Start KYC'}).click();
  await page.getByRole('radio',{name:/Amara Wilson/}).check();
  await page.getByRole('button',{name:'Use selected profile'}).click();
  await expect(page.getByRole('heading',{name:'Your positions.'})).toBeVisible();
  phase='full-claim quote';
  const beforeBalance=await chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]});
  await page.getByRole('button',{name:'Explore an exit'}).click();
  await expect(page.getByText('This instrument requires a full exit.')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Exit amount'})).toHaveValue('100000');
  await page.getByRole('button',{name:'See eligible offers'}).click();
  await expect(page.getByRole('heading',{name:'Compare your net payout.'})).toBeVisible();
  const choices=page.getByRole('button',{name:/Review offer/});
  expect(await choices.count()).toBeGreaterThanOrEqual(2);
  const firstBlock=await chain.getBlockNumber();
  await choices.first().click();
  await page.getByRole('checkbox',{name:/I have read this exact agreement/}).check();
  await page.getByRole('button',{name:'Sign agreement'}).click();
  await expect(page.getByRole('button',{name:'Confirm wallet settlement'})).toBeEnabled();
  const first=parseEventLogs({abi:events,eventName:'Reserved',logs:await chain.getLogs({address:m.settlement,fromBlock:firstBlock+1n})});
  expect(first).toHaveLength(1);const firstDigest=first[0].args.digest;
  phase='replace reserved bid';
  await page.getByRole('button',{name:'Back'}).click();
  await page.getByRole('button',{name:/Review offer/}).nth(1).click();
  await page.getByRole('checkbox',{name:/I have read this exact agreement/}).check();
  await page.getByRole('button',{name:'Sign agreement'}).click();
  await expect(page.getByRole('button',{name:'Confirm wallet settlement'})).toBeEnabled();
  const changed=parseEventLogs({abi:events,logs:await chain.getLogs({address:m.settlement,fromBlock:firstBlock+1n})});
  const canceled=changed.filter(x=>x.eventName==='Cancelled'),reserved=changed.filter(x=>x.eventName==='Reserved');
  expect(canceled.some(x=>x.args.digest===firstDigest)).toBe(true);
  expect(reserved).toHaveLength(2);const secondDigest=reserved[1].args.digest;expect(secondDigest).not.toBe(firstDigest);
  phase='full-claim settlement';
  await page.getByRole('button',{name:'Confirm wallet settlement'}).click();
  await expect(page.getByRole('heading',{name:'Your exit receipt.'})).toBeVisible();
  const settleTx=proof.filter(p=>p.method==='eth_sendTransaction').at(-1)?.transactionHash;expect(settleTx).toBeDefined();
  const receipt=await chain.getTransactionReceipt({hash:settleTx!});expect(receipt.status).toBe('success');
  const settled=parseEventLogs({abi:events,eventName:'Settled',logs:receipt.logs});expect(settled).toHaveLength(1);
  expect(settled[0].args.digest).toBe(secondDigest);expect(settled[0].args.units).toBe(100_000_000_000n);
  const final=await chain.readContract({address:m.registry,abi:registryAbi,functionName:'holding',args:[id!]});expect(final[2]).toBe(0n);
  const afterBalance=await chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]});
  expect(afterBalance-beforeBalance).toBe(settled[0].args.payout);
  checks.push({holding:id,firstDigest,secondDigest,cancelledFirst:true,fullUnits:String(settled[0].args.units),payout:String(settled[0].args.payout),balanceBefore:String(beforeBalance),balanceAfter:String(afterBalance),settlementHash:settleTx});
  screenshots.push(...await captureWidths(page,'birch','full-claim'));
 }catch(error){failure=error instanceof Error?error.stack??error.message:String(error);throw error;}
 finally{
  const video=page.video();await context.close();const source=await video?.path();if(source)videos.push(await copyVideo(source,'birch-full-claim'));
  await saveProof('birch-evidence.json',{environment:'LOCAL ANVIL TEST ONLY',phase,failure,sourceHashes:{test:await hashFile(resolve('test/demo-birch.spec.ts')),wallet:await hashFile(resolve('test/demo-wallet.ts')),manifest:await hashFile(resolve('public/demo-contracts.json'))},checks,walletProof:proof,screenshots,videos});
 }
});
