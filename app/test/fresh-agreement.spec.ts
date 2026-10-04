import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { exitAgreementText } from '../../harness/src/demo/legal-documents';
const wallet = `0x${'1'.repeat(40)}` as const;
const digest = `0x${'a'.repeat(64)}` as const;
const text = exitAgreementText({ documentId: 'exit-letter-ui-fixture', version: '2', createdAt: '2026-10-04T12:00:00.000Z', expiresAt: '2026-10-04T12:10:00.000Z', nonce: 'fixture-nonce', profile: { id: 'lucas-chen', name: 'Lucas Chen', jurisdiction: 'Singapore', identityRef: 'TEST-IDENTITY-001', identityHash: digest, wallet }, asset: { name: 'Lockgate custom TEST USDG', symbol: 'USDG', address: wallet, chainId: 421614, chainName: 'Arbitrum Sepolia', decimals: 6, kind: 'custom-test-usdg' }, vehicle: { id: 'northstar', name: 'Northstar Liquidity Vehicle', firm: 'Northstar Investment Firm', address: wallet, manager: wallet, termsHash: digest, termsText: 'TEST policy' }, holdingId: digest, holdingName: 'Cedar Income Fund', instrument: 'Fund interest', originator: { name: 'Cedar Income Trust', address: wallet }, settlement: wallet, route: 2, units: 99_000_000_000n, payout: 96_030_000_000n, repayment: 97_950_600_000n, residualUnits: 1_000_000_000n, maturity: '2026-11-04T12:00:00.000Z' });
// Isolated component fixture: no gateway, wallet calls or chain transactions.
async function fixture(page: Page, signed = false) {
  await page.route('**/src/main.tsx*', async route => {
    const source = await (await route.fetch()).text();
    const react = source.match(/from "([^"]*\/react\.js[^"]*)"/)![1];
    const reactDom = source.match(/from "([^"]*\/react-dom_client\.js[^"]*)"/)![1];
    await route.fulfill({ contentType: 'application/javascript', body: `
    import React from '${react}';
    import ReactDOM from '${reactDom}';
    import { AgreementDocument } from '/src/demo/AgreementDocument.tsx';
    import '/src/ui/base.css'; import '/src/demo/demo.css';
    const props=${JSON.stringify({ title: 'TEST financing and claim discharge letter', text, version: '2', documentId: 'exit-letter-ui-fixture', digest, identityName: 'Lucas Chen', signed, busy: false, signLabel: 'Sign agreement' })};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main',{className:'dg-app',style:{padding:'16px',maxWidth:'1100px',margin:'auto'}},React.createElement(AgreementDocument,{...props,onSign:name=>document.body.dataset.acceptedName=name})));
  ` }); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TEST financing and claim discharge letter', exact: true })).toBeVisible();
}
for (const width of [375, 768, 1440]) test(`fresh letter is readable at ${width}px and retains every canonical line`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await fixture(page);
  await expect(page.locator('.dg-legal-letterhead')).toContainText('Draft for review');
  await page.evaluate(() => document.fonts.ready);
  const count = await page.getByLabel('Page', { exact: true }).locator('option').count();
  expect(count).toBeGreaterThan(1);
  let rendered = '';
  for (let index = 0; index < count; index++) {
    await page.getByLabel('Page', { exact: true }).selectOption({ value: String(index) });
    await expect(page.locator('.dg-legal-paper')).toHaveAttribute('aria-label', new RegExp(`page ${index + 1} of`));
    rendered += await page.locator('.dg-legal-page-body .dg-legal-text').textContent();
    expect(await page.locator('.dg-legal-page-body').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  }
  expect(rendered).toBe(text);
  await page.getByLabel('Page', { exact: true }).selectOption({ value: '0' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('.dg-legal-page-body .dg-legal-text').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await page.locator('.dg-legal-paper').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('1');
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('0');
  if (width === 1440) {
    const controls = await page.locator('.dg-agreement-controls').boundingBox();
    const viewer = await page.locator('.dg-agreement-viewer').boundingBox();
    expect(viewer!.x).toBeGreaterThan(controls!.x + controls!.width);
  }
  if (process.env.LOCKGATE_VISUAL_REVIEW === '1') await page.screenshot({ path: `/tmp/lockgate-fresh-agreement-${width}.png` });
});
test('download is byte-exact and full name plus consent gates the signature', async ({ page }) => {
  await fixture(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .txt' }).click();
  expect(await readFile((await (await pending).path())!, 'utf8')).toBe(text);
  const name = page.getByRole('textbox', { name: 'Full name' });
  const sign = page.getByRole('button', { name: 'Sign agreement' });
  await expect(sign).toBeDisabled();
  await name.fill('Lucas');
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await name.fill('  LUCAS   CHEN  ');
  await expect(sign).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(sign).toBeEnabled();
  await sign.click();
  expect(await page.locator('body').getAttribute('data-accepted-name')).toBe('LUCAS CHEN');
  await name.fill('Lucas Chen');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(sign).toBeDisabled();
});
test('signed letter labels the recorded state and removes acceptance controls', async ({ page }) => {
  await fixture(page, true);
  await expect(page.locator('.dg-legal-letterhead')).toContainText('Signed copy');
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign agreement' })).toHaveCount(0);
});
test('print export preserves full unsigned text and page changes keep consent', async ({ page }) => {
  await fixture(page);
  await page.getByLabel('Full name').fill('Lucas Chen');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Lucas Chen');
  await expect(page.getByRole('checkbox')).toBeChecked();
  const pending = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print / PDF' }).click();
  const popup = await pending;
  await expect(popup.locator('header')).toContainText('Unsigned draft for review');
  expect(await popup.locator('pre').textContent()).toBe(text);
  await expect(popup.getByRole('button', { name: 'Print / save as PDF' })).toBeVisible();
  await popup.close();
});
