import { expect, test, type Page } from '@playwright/test';
// UI-only gateway fixtures; backend membership and authorization have separate tests.
async function fixture(page: Page) {
 await page.addInitScript(() => {
  localStorage.setItem('lockgate.wallet.connected.v1', '1');
  const listeners: Record<string, (value: unknown) => void> = {};
  Object.assign(window, { changeTestAccount: () => listeners.accountsChanged?.(['0x2222222222222222222222222222222222222222']), ethereum: {
   request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x66eee' : ['0x1111111111111111111111111111111111111111'],
   on: (event: string, callback: (value: unknown) => void) => { listeners[event] = callback; }, removeListener: () => {},
  } });
 });
 await page.route('**/src/services/demo-gateway.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
 const initial={profile:{roles:['investor'],activeRole:'investor',identity:{id:'lucas-chen',name:'Lucas Chen',jurisdiction:'Singapore',fixtureCase:'match'}},positions:[{id:'cedar',name:'Cedar Income Fund',originator:'Cedar Income Trust',instrument:'Fund interest',available:'1000',faceValue:'1000',partial:true}],positionStatus:'matched',vehicles:[],receipts:[{id:'receipt-existing',title:'Early payout received',status:'confirmed',amount:'96030',account:'0x1111111111111111111111111111111111111111',createdAt:'2026-10-04T12:00:00Z'}],agreements:[],setup:{gas:'0.0005',usdg:'96030',canMint:true,canFund:false},deploymentReady:true};
 let state=JSON.parse(localStorage.getItem('profile-ui-state')||'null')||initial;
 window.profileCalls=[];
 export function createDemoGateway(){return {publicOverview:async()=>({originators:5,firms:5,availableCash:'2000000',outstanding:'0',environment:'UI FIXTURE'}),authenticate:async()=>structuredClone(state),refresh:async()=>structuredClone(state),
 selectRole:(role,intent)=>{window.profileCalls.push({role,intent});return new Promise((resolve,reject)=>{const save=()=>{if(intent==='create'&&!state.profile.roles.includes(role))state.profile.roles.push(role);state.profile.activeRole=role;localStorage.setItem('profile-ui-state',JSON.stringify(state));};window.rejectProfile=()=>reject(new Error('Profile request failed'));window.loseProfileResponse=()=>{save();reject(new Error('Response interrupted'));};window.completeProfile=()=>{save();resolve(structuredClone(state));};});},selectIdentity:()=>{throw new Error('Existing identity must be reused');}};}
 ` }));
 await page.goto('/'); await page.getByRole('button', { name: 'Connect Wallet' }).click();
 await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}
async function add(page: Page) {
 await page.getByRole('button', { name: 'Profile: Exit investor' }).click();
 await page.getByRole('menuitem', { name: 'Add New Profile' }).click();
}
async function complete(page: Page) { await page.evaluate(() => Reflect.get(window, 'completeProfile')()); }
for (const width of [375, 768, 1440]) test(`same wallet adds provider and switches back retaining investor history at ${width}px`, async ({ page }) => {
 await page.setViewportSize({ width, height: 950 }); await fixture(page);
 const trigger = page.getByRole('button', { name: 'Profile: Exit investor' });
 await expect(trigger).toBeVisible();
 const name = page.locator(width <= 650 ? '.dg-profile-mobile .dg-profile-name' : '.dg-dashboard-sidebar .dg-profile-name');
 expect((await name.boundingBox())!.y).toBeLessThan((await trigger.boundingBox())!.y);
 await add(page);
 await expect(page.getByRole('heading', { name: 'Add a new profile.' })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Profile already exists — Exit investor' })).toBeDisabled();
 await page.getByRole('button', { name: 'Get Started — Capital provider' }).click();
 await expect(page.getByRole('heading', { name: 'Checking your vehicles…' })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Start KYC' })).toHaveCount(0);
 await complete(page);
 await expect(page.getByRole('button', { name: 'Profile: Capital provider' })).toBeVisible();
 await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
 await page.reload(); await page.getByRole('button', { name: 'Connect Wallet' }).click();
 await expect(page.getByRole('button', { name: 'Profile: Capital provider' })).toBeVisible();
 await expect(page.getByRole('region', { name: 'Account setup' })).toHaveCount(0);
 await page.getByRole('button', { name: 'Profile: Capital provider' }).click();
 await expect(page.getByRole('menuitemradio', { name: 'Capital provider' })).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('menuitemradio', { name: 'Exit investor' }).click(); await complete(page);
 await expect(page.getByRole('button', { name: 'Profile: Exit investor' })).toBeVisible();
 await expect(page.locator('.dg-dashboard-holdings')).toContainText('Cedar Income Fund');
 await expect(page.locator('.dg-dashboard-holdings')).toContainText('1,000');
 await expect(page.locator('.dg-transaction-history')).toContainText('Early payout received');
 await expect(page.locator('.dg-dashboard-metrics')).toContainText('96,030');
 await add(page);
 await expect(page.getByRole('button', { name: 'Profile already exists — Capital provider' })).toBeDisabled();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test('Add New Profile cancels to dashboard and enquiries do not change the active profile', async ({ page }) => {
 await fixture(page); await add(page);
 await page.getByRole('button', { name: 'Back to dashboard' }).click();
 await expect(page.getByRole('button', { name: 'Profile: Exit investor' })).toBeVisible();
 await add(page); await page.getByRole('button', { name: 'Talk to us — Licensed investment firm' }).click();
 await expect(page.getByRole('heading', { name: 'Let’s talk.' })).toBeVisible();
 expect(await page.evaluate(() => Reflect.get(window, 'profileCalls'))).toEqual([]);
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await page.getByRole('button', { name: 'Back to dashboard' }).click();
 await expect(page.getByRole('button', { name: 'Profile: Exit investor' })).toBeVisible();
});
test('profile menu supports keyboard focus, escape and outside dismissal', async ({ page }) => {
 await fixture(page);
 const trigger = page.getByRole('button', { name: 'Profile: Exit investor' });
 await trigger.focus(); await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitemradio', { name: 'Exit investor' })).toBeFocused();
 await page.keyboard.press('End'); await expect(page.getByRole('menuitem', { name: 'Add New Profile' })).toBeFocused();
 await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
 await expect(page.getByRole('menu', { name: 'Profiles' })).toHaveCount(0);
 await trigger.click(); await page.getByRole('heading', { name: 'Overview', exact: true }).click();
 await expect(page.getByRole('menu', { name: 'Profiles' })).toHaveCount(0);
});
test('late create response cannot apply a profile to a different wallet', async ({ page }) => {
 await fixture(page); await add(page); await page.getByRole('button', { name: 'Get Started — Capital provider' }).click();
 await page.evaluate(() => Reflect.get(window, 'changeTestAccount')()); await complete(page);
 await expect(page.getByRole('heading', { name: 'Verify your wallet.' })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Profile: Capital provider' })).toHaveCount(0);
});
test('failed profile creation can return to the existing profile', async ({ page }) => {
 await fixture(page); await add(page); await page.getByRole('button', { name: 'Get Started — Capital provider' }).click();
 await page.evaluate(() => Reflect.get(window, 'rejectProfile')());
 await expect(page.getByRole('button', { name: 'Retry account setup' })).toBeVisible();
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Profile already exists — Exit investor' })).toBeDisabled();
 await page.getByRole('button', { name: 'Back to dashboard' }).click();
 await expect(page.getByRole('button', { name: 'Profile: Exit investor' })).toBeVisible();
});
test('a lost response after profile creation recovers without attempting duplicate creation', async ({ page }) => {
 await fixture(page); await add(page); await page.getByRole('button', { name: 'Get Started — Capital provider' }).click();
 await page.evaluate(() => Reflect.get(window, 'loseProfileResponse')());
 await page.getByRole('button', { name: 'Retry account setup' }).click();
 await expect(page.getByRole('button', { name: 'Profile: Capital provider' })).toBeVisible();
 expect(await page.evaluate(() => Reflect.get(window, 'profileCalls'))).toEqual([{ role: 'provider', intent: 'create' }]);
});
