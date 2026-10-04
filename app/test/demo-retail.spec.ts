import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPublicClient,http,parseAbi,parseUnits,type Address} from 'viem';
import {injectDemoWallet,type WalletProof} from './demo-wallet';
import {captureWidths,copyVideo,evidenceDir,hashFile,prepareProof,saveProof,until} from './demo-proof';

const tokenAbi=parseAbi(['function balanceOf(address) view returns (uint256)']);
const vaultAbi=parseAbi(['function bookUnits(address) view returns (uint256)','function providerCount() view returns (uint256)']);

test('new wallet starts with no firm book and funds its own TEST interest',async({browser})=>{
 test.skip(process.env.LOCKGATE_DEMO_RETAIL!=='1','Run after main E2E on clean local chain.');
 test.setTimeout(180_000);await prepareProof();
 const m=JSON.parse(await readFile(resolve('public/demo-contracts.json'),'utf8')) as {asset:Address;vaults:{address:Address}[]};
 const chain=createPublicClient({transport:http('http://127.0.0.1:8545')});expect(await chain.getChainId()).toBe(421614);
 const proof:WalletProof[]=[],checks:unknown[]=[],screenshots:unknown[]=[],videos:unknown[]=[];
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5197',viewport:{width:1440,height:900},recordVideo:{dir:evidenceDir,size:{width:1440,height:900}}});
 context.setDefaultTimeout(20_000);
 const page=await context.newPage(),wallet=await injectDemoWallet(page,31,'retail-provider',proof);
 let phase='fresh wallet',failure:string|undefined;
 try{
  const before=await chain.readContract({address:m.vaults[0].address,abi:vaultAbi,functionName:'bookUnits',args:[wallet.account.address]});expect(before).toBe(0n);
  const gasBefore=await chain.getBalance({address:wallet.account.address});expect(gasBefore).toBe(0n);
  const tokenBefore=await chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]});expect(tokenBefore).toBe(0n);
  await page.goto('/');await page.getByRole('button',{name:/Connect wallet/}).click();
  await page.getByRole('button',{name:/Get Started — Capital provider/}).click();
  await page.getByRole('button',{name:'Demo',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Get test gas'}).click();
  await until(()=>chain.getBalance({address:wallet.account.address}),value=>value>0n);
  await page.getByRole('button',{name:'Close Demo'}).click();
  phase='fresh provider identity';
  await page.getByRole('button',{name:'Start KYC'}).click();
  await page.getByRole('radio',{name:/Hana Kim/}).check();
  await page.getByRole('button',{name:'Use selected profile'}).click();
  await expect(page.getByRole('heading',{name:'Choose your investment vehicle.'})).toBeVisible();
  const binding=proof.find(item=>item.method==='eth_sendTransaction');expect(binding).toBeDefined();
  phase='local test funding';
  await page.getByRole('button',{name:'Demo',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Get test USDG'}).click();
  await until(()=>chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]}),value=>value>=parseUnits('1000',6));
  await page.getByRole('button',{name:'Close Demo'}).click();
  phase='exact wallet subscription';
  await page.getByRole('button',{name:'View vehicle'}).first().click();
  await expect(page.getByText('Eligible for this vehicle')).toBeVisible();
  await page.getByRole('textbox',{name:'Subscription amount'}).fill('1000');
  await page.getByRole('button',{name:'Review terms'}).click();
  await page.getByRole('checkbox',{name:/I accept this agreement/}).check();
  await page.getByRole('button',{name:'Sign subscription'}).click();
  await expect(page.getByRole('button',{name:'Approve & fund 1,000 USDG'})).toBeEnabled();
  await page.getByRole('button',{name:'Approve & fund 1,000 USDG'}).click();
  await expect(page.getByRole('heading',{name:'Your vehicle interest.'})).toBeVisible();
  const after=await until(()=>chain.readContract({address:m.vaults[0].address,abi:vaultAbi,functionName:'bookUnits',args:[wallet.account.address]}),value=>value>0n);
  expect(after).toBeLessThanOrEqual(parseUnits('1000',6));
  const providers=await chain.readContract({address:m.vaults[0].address,abi:vaultAbi,functionName:'providerCount'});expect(providers).toBe(2n);
  const tokenAfter=await chain.readContract({address:m.asset,abi:tokenAbi,functionName:'balanceOf',args:[wallet.account.address]});expect(tokenAfter-tokenBefore).toBe(parseUnits('9000',6));
  await expect(page.getByText('Personal ledger')).toBeVisible();
  checks.push({account:wallet.account.address,bookBefore:String(before),bookAfter:String(after),providerCount:String(providers),gasBefore:String(gasBefore),gasAfter:String(await chain.getBalance({address:wallet.account.address})),testUsdgBefore:String(tokenBefore),testUsdgAfter:String(tokenAfter),identityBindingTx:binding?.transactionHash,actualWalletTransactions:proof.filter(item=>item.transactionHash).map(item=>item.transactionHash)});
  screenshots.push(...await captureWidths(page,'retail-provider','funded'));
 }catch(error){failure=error instanceof Error?error.stack??error.message:String(error);throw error;}
 finally{const video=page.video();await context.close();const source=await video?.path();if(source)videos.push(await copyVideo(source,'retail-provider'));await saveProof('retail-evidence.json',{environment:'LOCAL ANVIL TEST ONLY; admin faucet grants disposable gas and MockUSDG',phase,failure,checks,walletProof:proof,screenshots,videos,sourceHashes:{test:await hashFile(resolve('test/demo-retail.spec.ts')),manifest:await hashFile(resolve('public/demo-contracts.json'))}});}
});
