import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = ['https://openhouse.lockgate.finance', 'https://open-house.lockgate.finance'];
const directory = resolve('../docs/proof/live');
await mkdir(directory, { recursive: true });
const built = await readFile('dist/index.html', 'utf8');
const bundle = built.match(/src="([^"]+\.js)"/)?.[1];
const report = { checkedAt: new Date().toISOString(), expectedBundle: bundle, targets: [] };
const browser = await chromium.launch();
try {
  for (const target of targets) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(target);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(bundle);
    await expect(page.getByRole('heading', { name: /Your capital./ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Workspace' })).toHaveCount(0);
    const started = Date.now();
    await expect(page.locator('.public-data-note')).toContainText(/Block \d+/, { timeout: 45000 });
    const snapshotMs = Date.now() - started;
    const publicRead = await page.locator('.public-data-note').innerText();
    const name = new URL(target).hostname;
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: resolve(directory, `${name}-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    await expect(page.getByRole('alert').first()).toContainText('No browser wallet found');
    await page.getByRole('combobox', { name: 'Network', exact: true }).click();
    await page.getByRole('option', { name: 'Arbitrum One', exact: true }).click();
    await page.goto(`${target}/?network=42161#/overview`);
    await expect(page.getByRole('heading', { name: 'The exit desk is coming to Arbitrum One.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Capital in motion.' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Network', exact: true }).click();
    await page.getByRole('option', { name: 'Arbitrum Sepolia', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Capital in motion.' })).toBeVisible({ timeout: 45000 });
    await page.goto(`${target}/#/create`);
    await expect(page.getByRole('heading', { name: 'Start a fresh platform cycle.' })).toBeVisible({ timeout: 45000 });
    await expect(page.getByText('0xc37f', { exact: false }).first()).toBeVisible({ timeout: 45000 });
    if (target === targets[0]) await page.screenshot({ path: resolve(directory, 'create-read-only.png'), fullPage: true, animations: 'disabled' });
    expect(errors).toEqual([]);
    report.targets.push({ target, status: response.status(), snapshotMs, publicRead, responsiveWidths: [375, 768, 1440], missingWallet: 'actionable error', factoryRegistration: 'Actual owner read; owner-required state', networkSelection: 'One unavailable, Sepolia restored', runtimeErrors: errors });
    await context.close();
  }
  report.passed = true;
} finally {
  await browser.close();
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2));
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
