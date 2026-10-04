import { expect, test, type Page } from '@playwright/test';
// UI-only fixtures: no wallet signatures, transactions, or claims of chain verification.
async function fixture(page:Page,connected=true,pendingAuth=false) {
 if(connected)await page.addInitScript(()=>{localStorage.setItem('lockgate.wallet.connected.v1','1');Object.assign(window,{ethereum:{request:async({method}:{method:string})=>{if(method==='eth_chainId')return '0x66eee';if(method==='eth_accounts')return ['0x1111111111111111111111111111111111111111'];throw new Error(`Unexpected wallet action: ${method}`);},on:()=>{},removeListener:()=>{}}});});
 await page.route('**/src/services/demo-gateway.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
 const state={profile:{roles:[]},positions:[],positionStatus:'empty',vehicles:[],receipts:[],setup:{gas:'0',usdg:'0',canMint:false,canFund:false},deploymentReady:true};
 export function createDemoGateway(){return {
 publicOverview:async()=>({originators:0,firms:0,availableCash:'0',outstanding:'0',environment:'UI FIXTURE'}),
 authenticate:()=>${pendingAuth?"new Promise((resolve,reject)=>{window.resolveAuth=()=>resolve({...state});window.rejectAuth=()=>reject(new Error('Signature rejected'));})":"Promise.resolve({...state})"},refresh:async()=>({...state}),
 selectRole:role=>new Promise((resolve,reject)=>{window.resolveRole=()=>{state.profile.activeRole=role;resolve({...state})};window.rejectRole=()=>reject(new Error('UI fixture role failure'));}),
 selectIdentity:(id,onBound)=>new Promise(resolve=>{window.resolveBinding=()=>{state.profile.identity={id,name:'Alex Morgan',jurisdiction:'Singapore',fixtureCase:'match'};onBound?.()};window.resolveDiscovery=()=>resolve({...state});})
 }};` }));
 await page.goto('/');if(connected)await page.getByRole('button',{name:'Sign in to Lockgate'}).click();
}
for(const role of ['Exit investor','Capital provider'])test(`${role} reflects completed operations, not elapsed time`,async({page})=>{
 await fixture(page);await page.getByRole('button',{name:`Get Started — ${role}`}).click();
 const progress=page.getByRole('region',{name:'Account setup'});
 await expect(progress).toContainText(`Setting up your ${role.toLowerCase()} account`);
 await expect(progress).toContainText('Preparing…');
 await expect(page.getByRole('button',{name:/Preparing identity/})).toBeDisabled();
 await expect(page.getByRole('link',{name:'Records',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Switch workspace/})).toHaveCount(0);
 await page.evaluate(()=>Reflect.get(window,'resolveRole')());
 await expect(page.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Start KYC'}).click();
 await expect(page.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
 await page.getByRole('radio',{name:/Alex Morgan/}).check();await page.getByRole('button',{name:'Use selected profile'}).click();
 await expect(progress).toContainText('Linking identity…');
 await expect(progress).not.toContainText('Verified');
 await page.evaluate(()=>Reflect.get(window,'resolveBinding')());
 await expect(progress).toContainText('Verified');await expect(progress).toContainText('Checking…');
 await page.evaluate(()=>Reflect.get(window,'resolveDiscovery')());
 await expect(progress).toContainText('Ready');
 await expect(page.getByRole('heading',{name:role==='Exit investor'?'Your positions.':'Choose your investment vehicle.'})).toBeVisible();
});
test('failed role selection offers retry and cannot start identity binding',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Get Started — Exit investor'}).click();
 await page.evaluate(()=>Reflect.get(window,'rejectRole')());
 await expect(page.getByRole('button',{name:'Retry account setup'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Start KYC'})).toHaveCount(0);
});
for(const width of [375,768,1440])test(`compact onboarding fits ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await fixture(page);
 await page.getByRole('button',{name:'Get Started — Exit investor'}).click();
 const progress=page.getByRole('region',{name:'Account setup'});await expect(progress).toBeVisible();
 expect(await progress.locator('h2').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const box=await progress.boundingBox();expect(box).not.toBeNull();
 expect(Math.abs(box!.x+box!.width/2-width/2)).toBeLessThanOrEqual(1);
 expect(await progress.locator('h2').evaluate(el=>getComputedStyle(el).textAlign)).toBe('center');
 const steps=await progress.locator('ol').boundingBox();expect(Math.abs(steps!.x+steps!.width/2-width/2)).toBeLessThanOrEqual(1);
});

test('disconnected public entry has one header connection and no network control',async({page})=>{
 await fixture(page,false);
 await expect(page.getByRole('combobox',{name:'Network'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toHaveCount(1);
 await expect(page.locator('header').getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();
 await expect(page.getByRole('main').getByRole('button',{name:'Connect wallet',exact:true})).toHaveCount(0);
 await expect(page.locator('footer')).not.toContainText('USDG integration');
});
test('connected network menu disables Arbitrum One',async({page})=>{
 await fixture(page);
 await page.getByRole('combobox',{name:'Network'}).click();
 await expect(page.getByRole('option',{name:'Arbitrum One · Soon'})).toHaveAttribute('aria-disabled','true');
 await expect(page.getByRole('option',{name:'Arbitrum Sepolia'})).toBeEnabled();
 await page.keyboard.press('Escape');
});

test('pending wallet sign-in never displays a connected address or network menu',async({page})=>{
 await fixture(page,true,true);
 await expect(page.locator('header').getByRole('button',{name:'Connecting wallet…'})).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Network'})).toHaveCount(0);
 await expect(page.locator('.dg-wallet-menu')).toHaveCount(0);
 await page.evaluate(()=>Reflect.get(window,'rejectAuth')());
 await expect(page.locator('header').getByRole('button',{name:'Sign in to Lockgate'})).toBeVisible();
 await expect(page.locator('.dg-wallet-menu')).toHaveCount(0);
 await page.locator('header').getByRole('button',{name:'Sign in to Lockgate'}).click();
 await page.evaluate(()=>Reflect.get(window,'resolveAuth')());
 await expect(page.locator('.dg-wallet-menu')).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Network'})).toBeVisible();
});
