import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const issuer = '0xc37f3cC9C57F647212894a262F27fA21A371a752';
const draftKey = 'lockgate.platform-draft.v1';
async function identity(page: Page) {
  await page.getByLabel('Legal entity name', { exact: false }).fill('  Harbour Credit Pte Ltd  ');
  await page.getByLabel('Platform name', { exact: false }).fill('Harbour Income');
  await page.getByLabel('Issuer wallet', { exact: false }).fill(issuer);
}
async function review(page: Page) {
  await page.goto('/?preview=1#/onboarding');
  await identity(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Requested facility limit', { exact: false }).fill('1000');
  await page.getByLabel('Target repayment tenor', { exact: false }).fill('30');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Planned platform reserve', { exact: false }).fill('75');
  await page.getByRole('button', { name: '5. Review', exact: true }).click();
}
test('keyboard submission validates the current stage and focuses the next heading', async ({ page }) => {
  await page.goto('/?preview=1#/onboarding');
  await page.getByLabel('Legal entity name', { exact: false }).press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Platform details');
  await expect(page.getByLabel('Legal entity name', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: '5. Review', exact: true })).toBeDisabled();
  await identity(page);
  await page.getByLabel('Issuer wallet', { exact: false }).press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Facility terms');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.getByRole('button', { name: '2. Facility terms', exact: true })).toHaveAttribute('aria-current', 'step');
});
test('editing an earlier limit cannot bypass the reserve boundary through progress navigation', async ({ page }) => {
  await review(page);
  await page.getByRole('button', { name: '2. Facility terms', exact: true }).click();
  await page.getByLabel('Requested facility limit', { exact: false }).fill('1');
  await expect(page.getByRole('button', { name: '5. Review', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Planned reserve cannot exceed the requested facility limit.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Planned platform reserve', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Export platform plan', exact: true })).toHaveCount(0);
  await page.getByLabel('Planned platform reserve', { exact: false }).fill('0.5');
  await page.getByRole('button', { name: '5. Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export platform plan', exact: true })).toBeEnabled();
});
test('a browser storage failure keeps the current form editable and does not claim a saved plan', async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, draftKey);
  await page.goto('/?preview=1#/onboarding');
  await page.getByLabel('Legal entity name', { exact: false }).fill('Harbour Credit Pte Ltd');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Could not save');
  await expect(page.getByLabel('Legal entity name', { exact: false })).toHaveValue('Harbour Credit Pte Ltd');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
});
test('clearing a saved draft clears form and restored progress', async ({ page }) => {
  await review(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '5. Review', exact: true })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Clear local draft', exact: true }).click();
  await expect(page.getByLabel('Legal entity name', { exact: false })).toHaveValue('');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: '1. Platform details', exact: true })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByLabel('Legal entity name', { exact: false })).toHaveValue('');
});
test('export downloads the validated draft and leaves a truthful editable completion state', async ({ page }) => {
  const submitted: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') submitted.push(request.url()); });
  await review(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export platform plan', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('lockgate-platform-plan.json');
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(JSON.parse(await readFile(path!, 'utf8'))).toEqual({ version: 1, status: 'draft', network: 'Arbitrum Sepolia',
    company: 'Harbour Credit Pte Ltd', platform: 'Harbour Income', issuer, limit: '1000', tenor: '30', reserve: '75', integration: 'weekly' });
  await expect(page.getByRole('status')).toContainText('No application was submitted');
  await page.getByRole('button', { name: 'Review plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export platform plan', exact: true })).toBeEnabled();
  await expect(page.getByText('Harbour Income', { exact: true })).toBeVisible();
  expect(submitted).toEqual([]);
});
for (const width of [375, 768, 1440]) {
  test(`persistent onboarding actions remain visible at ${width}px and short viewport height`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?preview=1#/onboarding');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport();
    await identity(page);
    await page.getByLabel('Issuer wallet', { exact: false }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
