import { expect, test, type Page } from '@playwright/test';
// UI-only gateway fixtures; no token issuance or wallet transaction is performed.
const hash = `0x${'c'.repeat(64)}`;
async function fixture(page: Page, used = false, refreshFailure = false) {
 await page.addInitScript(() => { localStorage.setItem('lockgate.wallet.connected.v1','1'); Object.assign(window,{ethereum:{request:async({method}:{method:string})=>method==='eth_chainId'?'0x66eee':['0x1111111111111111111111111111111111111111'],on:()=>{},removeListener:()=>{}}}); });
 await page.route('**/src/services/demo-gateway.ts*', route => route.fulfill({contentType:'application/javascript',body:`
 const state={profile:{roles:['provider'],activeRole:'provider',identity:{id:'lucas-chen',name:'Lucas Chen',jurisdiction:'Singapore',fixtureCase:'match'}},positions:[],positionStatus:'empty',vehicles:[],receipts:[],setup:{gas:'0.0005',usdg:'0',canMint:false,canFund:true,canGetUsdg:${!used},fundingAmount:'10000'},deploymentReady:true};
 window.usdgCalls=0;let done=false;
 export function createDemoGateway(){return {publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0'}),authenticate:async()=>structuredClone(state),getTestUsdg:()=>{window.usdgCalls++;return new Promise((resolve,reject)=>{window.completeUsdg=()=>{done=true;resolve({id:'usdg',title:'TEST USDG funded',status:'confirmed',hash:'${hash}',amount:'10000',createdAt:'2026-10-04T12:00:00Z',account:'0x1111111111111111111111111111111111111111'})};window.failUsdg=()=>reject(new Error('Token mint is unavailable. Retry this same action.'));})},refresh:async()=>{if(${refreshFailure})throw new Error('Balance refresh unavailable');if(done){state.setup.usdg='10000';state.setup.canGetUsdg=false;}return structuredClone(state);}};}
 `}));
 await page.goto('/'); await page.getByRole('button',{name:'Connect Wallet'}).click();
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Demo',exact:true}).click();
 return page.getByRole('dialog',{name:'Demo setup'});
}
test('custom USDG mints once, shows only its active loader and updates balance with proof', async ({page}) => {
 const sheet=await fixture(page);
 await expect(sheet.getByRole('link',{name:'Get test USDG'})).toHaveCount(0);
 await sheet.getByRole('button',{name:'Mint test USDG',exact:true}).click();
 const active=sheet.getByRole('button',{name:'Minting test USDG…'});
 await expect(active).toBeDisabled(); await expect(active.locator('.dg-spin')).toHaveCount(1);
 await expect(sheet.getByRole('button',{name:'Check setup'}).locator('.dg-spin')).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'Mint test position'}).locator('.dg-spin')).toHaveCount(0);
 await page.evaluate(()=>Reflect.get(window,'completeUsdg')());
 await expect(sheet.getByRole('status')).toContainText('Test USDG minted');
 await expect(sheet.getByRole('status')).toContainText('10,000 custom test USDG');
 await expect(sheet.getByRole('link',{name:'View transaction in explorer'})).toHaveAttribute('href',`https://sepolia.arbiscan.io/tx/${hash}`);
 await expect(sheet.getByRole('button',{name:'Test USDG claimed'})).toBeDisabled();
 await expect(sheet.locator('.dg-rows')).toContainText('10,000 USDG');
 expect(await page.evaluate(()=>Reflect.get(window,'usdgCalls'))).toBe(1);
});
test('already claimed faucet is disabled after reopening',async({page})=>{
 const sheet=await fixture(page,true); await expect(sheet.getByRole('button',{name:'Test USDG claimed'})).toBeDisabled();
});
test('confirmed issuance retains its explorer proof when balance refresh fails',async({page})=>{
 const sheet=await fixture(page,false,true);await sheet.getByRole('button',{name:'Mint test USDG',exact:true}).click();await page.evaluate(()=>Reflect.get(window,'completeUsdg')());
 await expect(sheet.getByRole('status')).toContainText('Test USDG minted'); await expect(sheet.getByRole('status')).toContainText('Check setup');
 await expect(sheet.getByRole('button',{name:'Test USDG claimed'})).toBeDisabled();
});
test('issuance error is actionable inside the sheet and does not show success',async({page})=>{
 const sheet=await fixture(page);await sheet.getByRole('button',{name:'Mint test USDG',exact:true}).click();await page.evaluate(()=>Reflect.get(window,'failUsdg')());
 await expect(sheet.getByRole('alert')).toContainText('Token mint is unavailable');await expect(sheet.getByRole('button',{name:'Mint test USDG',exact:true})).toBeEnabled();
});
for(const width of [375,768,1440])test(`USDG mint setup fits ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const sheet=await fixture(page);
 await expect(sheet.getByRole('button',{name:'Mint test USDG',exact:true})).toBeVisible();
 expect(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 if(process.env.LOCKGATE_VISUAL_REVIEW)await page.screenshot({path:`/tmp/lockgate-usdg-setup-${width}.png`});
});
