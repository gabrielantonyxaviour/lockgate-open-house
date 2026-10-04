import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = ['https://openhouse.lockgate.finance', 'https://open-house.lockgate.finance'];
const directory = resolve('docs/proof/entry-refinement/live');
const platform = '0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25';
const account = '0x1111111111111111111111111111111111111111';
await mkdir(directory, { recursive: true });
const built = await readFile('dist/index.html', 'utf8');
const bundle = built.match(/src="([^"]+\.js)"/)?.[1];
expect(bundle).toBeTruthy();
const report = { checkedAt: new Date().toISOString(), expectedBundle: bundle,
  scope: 'Deployed UI and actual public Sepolia reads. Connected checks use a read-only EIP-1193 account-restoration bridge; no native wallet popup or signing.',
  transactions: 0, targets: [] };
const browser = await chromium.launch();
try {
  for (const target of targets) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(`${target}/#/start/issuer`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(bundle);
    await expect(page.getByRole('heading', { name: 'Manage your platform facility.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Prepare a local facility draft/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Start platform onboarding/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Explore platform terms', exact: true }).click();
    await expect(page).toHaveURL(/#\/terms\?from=issuer$/);
    await expect(page.locator('.terms-platform').first()).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.locator('.data-status')).toBeHidden();
    const publicRead = await page.locator('.terms-source').innerText();
    await page.locator(`a[href="#/terms/${platform}?from=issuer"]`).click();
    await expect(page.getByRole('heading', { name: 'Northwind weekly', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Northwind weekly', exact: true })).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to issuer journey', exact: true }).click();
    await expect(page).toHaveURL(/#\/start\/issuer$/);
    await page.goto(`${target}/#/onboarding`);
    await expect(page.getByRole('button', { name: 'Connect issuer wallet', exact: true })).toBeVisible();
    await expect(page.getByLabel('Legal entity name', { exact: false })).toHaveCount(0);
    // Bridge identifies an account only. All balances, terms and permissions use the real public RPC.
    await context.addInitScript(account => {
      localStorage.setItem('lockgate.wallet.connected.v1', '1');
      Object.assign(window, { ethereum: {
        request: async ({ method }) => {
          if (method === 'eth_chainId') return '0x66eee';
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
          throw new Error(`Read-only verification forbids wallet action: ${method}`);
        }, on: () => {}, removeListener: () => {},
      } });
    }, account);
    await page.goto(`${target}/#/start/issuer`);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Start platform onboarding', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Start platform onboarding', exact: true }).click();
    await expect(page.getByLabel('Legal entity name', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
    const name = new URL(target).hostname;
    const matrix = [];
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [label, route] of [['onboarding', '/onboarding'], ['terms', '/terms?from=issuer'], ['detail', `/terms/${platform}?from=issuer`]]) {
        await page.goto(`${target}/#${route}`);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toBeVisible();
        if (label !== 'onboarding') await expect(page.locator('.terms-source')).toContainText(/Block \d+/, { timeout: 45000 });
        if (label === 'detail') await expect(heading).toHaveText('Northwind weekly');
        await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
        const size = await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeLessThanOrEqual(width === 375 ? 28 : 32);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: resolve(directory, `${name}-${label}-${width}.png`), fullPage: true, animations: 'disabled' });
        matrix.push({ route, width, headingPx: size, sidebar: false, overflow: 0 });
      }
    }
    expect(errors).toEqual([]);
    report.targets.push({ target, status: response.status(), publicRead, disconnectedGate: true,
      connectedLocalDraft: true, originAndReload: true, matrix, runtimeErrors: errors });
    await context.close();
  }
  report.passed = true;
} finally {
  await browser.close();
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
