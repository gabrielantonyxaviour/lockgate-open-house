import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AgreementRecord } from '../src/demo/types';
const original = 'Lockgate local TEST exit. Holding: Cedar Income Fund; units: 99000; route: financing with claim discharge; firm: Northstar Investment Firm; immediate payout: 96030 test USDG. The original investor retains 1000 TEST units. This is a local test agreement, not a production investment.';
const digest = `0x${'a'.repeat(64)}` as const;
const legacy: AgreementRecord = { id: 'exit-terms-ba6e72f45def', title: 'TEST early exit agreement', version: '1', text: original, digest, signedAt: '2026-10-04T12:52:14.490Z', status: 'Signed TEST exit agreement' };
// UI-only fixtures verify presentation and downloads, not legal or chain validity.
async function fixture(page: Page, agreement = legacy) {
  await page.addInitScript(() => {
    localStorage.setItem('lockgate.wallet.connected.v1', '1');
    Object.assign(window, { ethereum: { request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x66eee' : ['0x1111111111111111111111111111111111111111'], on: () => {}, removeListener: () => {} } });
  });
  const state = { profile: { roles: ['investor'], activeRole: 'investor', identity: { id: 'lucas-chen', name: 'Lucas Chen', jurisdiction: 'Singapore', fixtureCase: 'match' } }, positions: [], positionStatus: 'empty', vehicles: [], receipts: [], agreements: [agreement], setup: { gas: '0', usdg: '0', canMint: false, canFund: false }, deploymentReady: true };
  await page.route('**/src/services/demo-gateway.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export function createDemoGateway(){return {publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0',environment:'UI FIXTURE'}),authenticate:async()=>(${JSON.stringify(state)})}};` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '/agreements'; });
  await expect(page.getByRole('heading', { name: 'Agreements', exact: true })).toBeVisible();
}
test('legacy document retains original text, digest and download bytes', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.dg-legal-page-body .dg-legal-text')).toHaveText(original);
  await expect(page.locator('.dg-record-evidence')).toContainText('4 October 2026');
  await expect(page.locator('.dg-record-evidence')).toContainText('12:52 UTC');
  await expect(page.locator('.dg-record-signature strong')).toHaveCount(0);
  await expect(page.locator('.dg-record-digest')).toContainText('0xaaaaaa…aaaaaa');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .txt' }).click();
  const download = await pending;
  expect(await readFile((await download.path())!, 'utf8')).toBe(original);
  expect(download.suggestedFilename()).toBe('lockgate-exit-terms-ba6e72f45def.txt');
});
test('long documents show clauses and only the recorded signer', async ({ page }) => {
  const text = 'LOCKGATE — TEST EXECUTION DOCUMENT\nEARLY EXIT AGREEMENT\n\n1. PURPOSE AND PARTIES\n\nThe named investor requests an early payout.\n\n2. SETTLEMENT\n\nSettlement follows the accepted terms.';
  await fixture(page, { ...legacy, version: '2', text, signerName: 'Lucas Chen' });
  await expect(page.locator('.dg-legal-page-body')).toContainText('1. PURPOSE AND PARTIES');
  await expect(page.locator('.dg-legal-page-body')).toContainText('2. SETTLEMENT');
  await expect(page.locator('.dg-record-signature strong')).toHaveText('Lucas Chen');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .txt' }).click();
  expect(await readFile((await (await pending).path())!, 'utf8')).toBe(text);
});
for (const width of [375, 768, 1440]) test(`agreement letter fits ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await fixture(page);
  await expect(page.locator('.dg-record-paper')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('.dg-legal-page-body .dg-legal-text').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Georgia');
  if (process.env.LOCKGATE_VISUAL_REVIEW === '1') await page.screenshot({ path: `/tmp/lockgate-agreement-${width}.png`, fullPage: true });
});
