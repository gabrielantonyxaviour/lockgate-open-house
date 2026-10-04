import { expect, test } from '@playwright/test';
// Presentation fixtures only: this test does not simulate settlement or prove chain execution.
for (const width of [375, 768, 1440]) for (const role of ['investor', 'provider']) test(`${role} keeps records on their own pages at ${width}px`, async ({ page }) => {
 await page.setViewportSize({ width, height: 950 });
 await page.addInitScript(() => {
  localStorage.setItem('lockgate.wallet.connected.v1', '1');
  Object.assign(window, { ethereum: { request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x66eee' : ['0x1111111111111111111111111111111111111111'], on: () => {}, removeListener: () => {} } });
 });
 const state = { profile: { roles: [role], activeRole: role, identity: { id: 'lucas-chen', name: 'Lucas Chen', jurisdiction: 'Singapore', fixtureCase: 'match' } }, positions: [{ id: 'cedar', name: 'Cedar Income Fund', originator: 'Cedar Income Trust', instrument: 'Fund interest', available: '1000', partial: true }], positionStatus: 'matched', vehicles: [{ id: 'northstar', name: 'Northstar Credit Vehicle', firm: 'Northstar Investment Firm', nav: '500000', cash: '400000', minimum: '100', providerPrincipal: '1000', providerNav: '1010', income: '10', loss: '0', withdrawable: '1010', queued: '0', claimable: '0', eligible: true }], receipts: [{ id: 'existing', title: 'Early payout received', status: 'confirmed', amount: '96030', createdAt: '2026-10-04T12:00:00Z' }], agreements: [{ id: 'signed-exit', title: 'Early exit agreement', version: '1', text: 'Original signed terms.', digest: `0x${'a'.repeat(64)}`, signedAt: '2026-10-04T12:00:00Z', status: 'Signed' }], setup: { gas: '0.0005', usdg: '96030', canMint: false, canFund: false }, deploymentReady: true };
 await page.route('**/src/services/demo-gateway.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export function createDemoGateway(){return {publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0'}),authenticate:async()=>(${JSON.stringify(state)}),refresh:async()=>(${JSON.stringify(state)}),withdraw:async()=>({id:"withdrawal",hash:"0x${'b'.repeat(64)}",title:"Withdrawal requested",status:"confirmed",amount:"10"})}};` }));
 await page.goto('/'); await page.getByRole('button', { name: 'Connect Wallet' }).click();
 await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
 await page.evaluate(path => { location.hash = path; }, role === 'provider' ? '/vehicles' : '/positions');
 await expect(page.getByRole('heading', { name: role === 'provider' ? 'Choose your investment vehicle.' : 'Your positions.' })).toBeVisible();
 await expect(page.locator('.dg-transaction-history')).toHaveCount(0);
 await expect(page.locator('.dg-record-paper')).toHaveCount(0);
 if (role === 'provider') {
  await page.getByRole('button', { name: 'View vehicle' }).click();
  await expect(page.getByRole('heading', { name: 'Personal ledger' })).toBeVisible();
  await expect(page.locator('.dg-transaction-history')).toHaveCount(0);
  await expect(page.locator('.dg-record-paper')).toHaveCount(0);
  await page.getByLabel('Amount in USDG').fill('10');
  await page.getByRole('button', { name: 'Request withdrawal' }).click();
  await expect(page.getByRole('link', { name: 'View transactions' })).toBeVisible();
  await expect(page.locator('.dg-transaction-history')).toHaveCount(0);
 }
 if (process.env.LOCKGATE_VISUAL_REVIEW) await page.screenshot({ path: `/tmp/lockgate-${role}-page-${width}.png`, fullPage: true });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
 await page.evaluate(() => { location.hash = '/records'; });
 await expect(page.locator('.dg-transaction-history')).toContainText('Early payout received');
 await expect(page.locator('.dg-record-paper')).toHaveCount(0);
 await page.evaluate(() => { location.hash = '/agreements'; });
 await expect(page.locator('.dg-record-paper')).toContainText('Original signed terms.');
 await expect(page.locator('.dg-transaction-history')).toHaveCount(0);
});
