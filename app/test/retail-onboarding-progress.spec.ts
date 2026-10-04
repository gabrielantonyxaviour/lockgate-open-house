import { expect, test, type Page } from '@playwright/test';
import type { Receipt } from '../src/demo/types';
// UI-only fixtures: no wallet signatures, transactions, or claims of chain verification.
async function fixture(page:Page,connected=true,pendingAuth=false,receipts:Receipt[]=[],returningRole?:'investor'|'provider') {
 if(connected)await page.addInitScript(()=>{localStorage.setItem('lockgate.wallet.connected.v1','1');Object.assign(window,{ethereum:{request:async({method}:{method:string})=>{if(method==='eth_chainId')return '0x66eee';if(method==='eth_accounts')return ['0x1111111111111111111111111111111111111111'];throw new Error(`Unexpected wallet action: ${method}`);},on:()=>{},removeListener:()=>{}}});});
 await page.route('**/src/services/demo-gateway.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
 const state={profile:${JSON.stringify(returningRole?{roles:[returningRole],activeRole:returningRole,identity:{id:'alex-morgan',name:'Alex Morgan',jurisdiction:'Singapore',fixtureCase:'match'}}:{roles:[]})},positions:${JSON.stringify(returningRole==='investor'?[{id:'position-ui',name:'Cedar Income Fund',originator:'Cedar Income Trust',instrument:'Fund interest',available:'100',faceValue:'100',partial:true}]:[])},positionStatus:'${returningRole==='investor'?'matched':'empty'}',vehicles:[],receipts:${JSON.stringify(receipts)},setup:{gas:'0',usdg:'0',canMint:false,canFund:false},deploymentReady:true};
 export function createDemoGateway(){return {
 publicOverview:async()=>({originators:0,firms:0,availableCash:'0',outstanding:'0',environment:'UI FIXTURE'}),
 authenticate:()=>${pendingAuth?"new Promise((resolve,reject)=>{window.resolveAuth=()=>resolve({...state});window.rejectAuth=()=>reject(new Error('Signature rejected'));})":"Promise.resolve({...state})"},refresh:async()=>({...state}),
 offers:async()=>[],selectRole:role=>new Promise((resolve,reject)=>{window.resolveRole=()=>{state.profile.activeRole=role;resolve({...state})};window.rejectRole=()=>reject(new Error('UI fixture role failure'));}),
 selectIdentity:(id,onBound)=>new Promise((resolve,reject)=>{window.rejectBinding=()=>reject(new Error('Identity transaction rejected'));window.resolveBinding=()=>{state.profile.identity={id,name:'Alex Morgan',jurisdiction:'Singapore',fixtureCase:'match'};if(state.profile.activeRole==='investor'){state.positions=[{id:'position-ui',name:'Cedar Income Fund',originator:'Cedar Income Trust',instrument:'Fund interest',available:'100',faceValue:'100',partial:true}];state.positionStatus='matched';}onBound?.()};window.resolveDiscovery=()=>resolve({...state});})
 }};` }));
 await page.goto('/');if(connected)await page.getByRole('button',{name:'Connect Wallet'}).click();
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
 await expect(page.getByRole('dialog')).toContainText('Completing KYC…');
 await expect(progress).not.toContainText('Verified');
 await page.evaluate(()=>Reflect.get(window,'resolveBinding')());
 await expect(progress).toContainText('Verified');await expect(progress).toContainText('Checking…');
 await page.evaluate(()=>Reflect.get(window,'resolveDiscovery')());
 await expect(progress).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Dashboard navigation'}).getByRole('link',{name:role==='Exit investor'?'My positions':'Investment vehicles'}).click();
 await expect(page.getByRole('heading',{name:role==='Exit investor'?'Your positions.':'Choose your investment vehicle.'})).toBeVisible();
 if(role==='Exit investor'){await page.getByRole('button',{name:'Explore an exit'}).click();await expect(progress).toHaveCount(0);await page.getByRole('textbox',{name:'Exit amount'}).fill('10');await page.getByRole('button',{name:'See eligible offers'}).click();await expect(page.getByRole('heading',{name:'Compare your net payout.'})).toBeVisible();await expect(progress).toHaveCount(0);}
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
 await expect(page.getByRole('button',{name:'Connect Wallet',exact:true})).toHaveCount(1);
 await expect(page.locator('header').getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();
 await expect(page.getByRole('main').getByRole('button',{name:'Connect Wallet',exact:true})).toHaveCount(0);
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
 await expect(page.locator('header').getByRole('button',{name:'Connect Wallet'})).toBeVisible();
 await expect(page.locator('.dg-wallet-menu')).toHaveCount(0);
 await page.locator('header').getByRole('button',{name:'Connect Wallet'}).click();
 await page.evaluate(()=>Reflect.get(window,'resolveAuth')());
 await expect(page.locator('.dg-wallet-menu')).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Network'})).toBeVisible();
});

test('KYC dialog loads, keeps rejection recoverable and uses a single selection outline',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Get Started — Exit investor'}).click();
 await page.evaluate(()=>Reflect.get(window,'resolveRole')());
 const start=page.getByRole('button',{name:'Start KYC'});await start.click();
 await expect(page.getByRole('dialog')).toContainText('Loading test profiles…');
 await page.getByRole('button',{name:'Close identity verification'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(start).toBeFocused();
 await start.click();const choice=page.getByRole('radio',{name:'Alex Morgan',exact:true});await choice.check();
 const card=page.locator('.dg-profile-choice.selected');
 expect(await card.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
 expect(await card.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
 await page.getByRole('button',{name:'Use selected profile'}).click();
 await expect(page.getByRole('button',{name:'Close identity verification'})).toBeDisabled();
 await page.evaluate(()=>Reflect.get(window,'rejectBinding')());
 await expect(page.getByRole('dialog')).toContainText('Identity transaction rejected');
 await expect(choice).toBeChecked();await expect(page.getByRole('button',{name:'Use selected profile'})).toBeEnabled();
});
test('wallet menu truncates the address without a tooltip',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:/Wallet 0x1111/}).click();
 const copy=page.getByRole('button',{name:'Copy wallet address'});
 await expect(page.locator('.dg-wallet-address-row code')).toHaveText('0x1111…1111');
 await copy.hover();await expect(page.getByRole('tooltip')).toHaveCount(0);
 await expect(copy).toBeVisible();
});

test('history adds explorer links and opens only useful transaction details',async({page})=>{
 const account='0x1111111111111111111111111111111111111111' as const;
 const hash=`0x${'a'.repeat(64)}` as const;
 await fixture(page,true,false,[
  {id:'gas',title:'Test gas funded',detail:'Test ETH for signing transactions.',status:'confirmed',account,hash,amount:'0.0005 ETH',createdAt:'2026-10-04T12:00:00Z'},
  {id:'exit',title:'Exit settled',detail:'Payout and position update confirmed.',status:'confirmed',account,hash,amount:'1.93 USDG',residual:'1',createdAt:'2026-10-04T12:01:00Z'}
 ]);
 await page.getByRole('button',{name:'Get Started — Exit investor'}).click();await page.evaluate(()=>Reflect.get(window,'resolveRole')());
 await page.getByRole('button',{name:'Start KYC'}).click();await page.getByRole('radio',{name:'Alex Morgan',exact:true}).check();
 await page.getByRole('button',{name:'Use selected profile'}).click();await page.evaluate(()=>{Reflect.get(window,'resolveBinding')();Reflect.get(window,'resolveDiscovery')();});
 await page.getByRole('navigation',{name:'Dashboard navigation'}).getByRole('link',{name:'Transaction history'}).click();
 await expect(page.getByRole('heading',{name:'Transaction History',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'View details for Test gas funded'})).toHaveCount(0);
 const explorer=page.getByRole('link',{name:'View Test gas funded transaction in explorer'});
 await expect(explorer).toHaveAttribute('href',`https://sepolia.arbiscan.io/tx/${hash}`);await expect(explorer).toHaveAttribute('target','_blank');
 await page.getByRole('button',{name:'View details for Exit settled'}).click();
 await expect(page.getByRole('dialog')).toContainText('Residual units');await expect(page.getByRole('dialog')).toContainText('0x111111…111111');await expect(page.getByRole('dialog').getByRole('link',{name:'View address in explorer'})).toHaveAttribute('href',`https://sepolia.arbiscan.io/address/${account}`);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

for(const role of ['investor','provider'] as const)test(`returning ${role} opens dashboard without onboarding`,async({page})=>{
 await fixture(page,true,false,[],role);
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Dashboard navigation'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Account setup'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Choose your path.'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Start KYC'})).toHaveCount(0);
 await expect(page.locator('.dg-dashboard-sidebar')).toContainText('Alex Morgan');
 await expect(page.locator('.dg-dashboard-sidebar')).not.toContainText('TEST identity');
});

async function dashboardNav(page:Page){const disclosure=page.getByLabel('Navigation',{exact:true});if(await disclosure.isVisible()){await disclosure.click();return page.getByRole('navigation',{name:'Mobile account navigation'});}return page.getByRole('navigation',{name:'Dashboard navigation'});}
for(const width of [375,768,1440])test(`dashboard navigation and direct exit fit ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await fixture(page,true,false,[],'investor');
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('button',{name:'Explore an exit'}).click();await expect(page.getByRole('heading',{name:'How much would you like to exit?'})).toBeVisible();await expect(page.getByRole('region',{name:'Account setup'})).toHaveCount(0);
 await (await dashboardNav(page)).getByRole('link',{name:'Account',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'View address in explorer'})).toHaveAttribute('href','https://sepolia.arbiscan.io/address/0x1111111111111111111111111111111111111111');
 await (await dashboardNav(page)).getByRole('link',{name:'Agreements',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Agreements',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
