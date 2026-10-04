import { test, expect, type Page } from '@playwright/test';
const address = '0x1111111111111111111111111111111111111111';
const platform = '0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25';
async function connected(page: Page, issuer = false) {
  await page.addInitScript(address => {
    localStorage.setItem('lockgate.wallet.connected.v1', '1');
    Object.assign(window, { ethereum: {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x66eee';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address];
        throw new Error(`Unexpected wallet action: ${method}`);
      },
      on: () => {}, removeListener: () => {},
    } });
  }, address);
  // Explicit layout fixture; this suite never claims signing or public-chain writes.
  await page.route('**/src/ui/preview.ts*', async route => {
    if (route.request().url().includes('entry-fixture-base')) return route.continue();
    await route.fulfill({ contentType: 'application/javascript', body:
      `import {previewSnapshot as original} from '/src/ui/preview.ts?entry-fixture-base';
       export function previewSnapshot(){const s=original();s.account='${address}';
       ${issuer ? 's.roles.issuerPlatforms=[s.platforms[0].address];' : ''}return s;}` });
  });
}
for (const role of ['investor', 'issuer']) {
  test(`${role} terms remain standalone with a connected wallet and preserve the return path`, async ({ page }) => {
    await connected(page);
    await page.goto(`/?preview=1#/start/${role}`);
    await page.getByRole('link', { name: /Explore platform terms/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/terms\\?from=${role}$`));
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('platform terms');
    const detail = page.locator(`a[href="#/terms/${platform}?from=${role}"]`).first();
    await detail.click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Weekly credit platform');
    await expect(page.getByRole('textbox', { name: 'Fund a position amount' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: /Back to .*journey/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/start/${role}$`));
  });
}
test('facility planning appears after connection and remains a standalone local flow', async ({ page }) => {
  await page.goto('/?preview=1#/start/issuer');
  await expect(page.getByRole('link', { name: /Prepare a local facility draft/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Start platform onboarding/ })).toHaveCount(0);
  await connected(page);
  await page.reload();
  await page.getByRole('link', { name: /Start platform onboarding/ }).click();
  await expect(page).toHaveURL(/#\/onboarding$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByLabel('Legal entity name', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export platform plan', exact: true })).toHaveCount(0);
});
test('an existing issuer keeps its direct workspace entry', async ({ page }) => {
  await connected(page, true);
  await page.goto('/?preview=1#/start/issuer');
  await expect(page.getByRole('link', { name: 'Open issuer workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Prepare a local facility draft/ })).toHaveCount(0);
});
test('a missing terms deep link remains standalone after reload', async ({ page }) => {
  await connected(page);
  await page.goto(`/?preview=1#/terms/${address}?from=issuer`);
  await expect(page.getByRole('heading', { name: 'Platform not found', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await page.getByRole('link', { name: 'All platform terms', exact: true }).click();
  await expect(page).toHaveURL(/#\/terms\?from=issuer$/);
});
test('a failed public read does not block connected local onboarding', async ({ page }) => {
  await connected(page);
  await page.route('https://**', route => route.abort());
  await page.goto('/#/start/issuer');
  await page.getByRole('link', { name: 'Start platform onboarding', exact: true }).click();
  await expect(page.getByLabel('Legal entity name', { exact: false })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
});
for (const width of [375, 768, 1440]) {
  test(`entry headings remain compact and forms fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await connected(page);
    for (const route of ['/choose', '/start/investor', '/start/issuer', '/onboarding', '/terms?from=issuer', `/terms/${platform}?from=issuer`]) {
      await page.goto(`/?preview=1#${route}`);
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
      expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(width === 375 ? 28 : 32);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    }
  });
}
