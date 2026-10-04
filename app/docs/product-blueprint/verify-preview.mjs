// Checks the local review artifact. This cannot pass financial demo acceptance IDs.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { roles, journeys, scenarios } from './preview/data.js';

const base = 'http://127.0.0.1:5197/docs/product-blueprint/';
const artifacts = await mkdtemp(path.join(os.tmpdir(), 'lockgate-reviewed-'));
const browser = await chromium.launch();
const errors = [], badResponses = [], serviceCalls = [];
const result = { scope: 'Local design review only', renders: 0, blockedScenarios: 0,
  widths: [375, 768, 1440], checks: [], errors, badResponses, serviceCalls, artifacts };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1:5197/')) badResponses.push(`${r.status()} ${r.url()}`);
  });
  page.on('request', r => {
    if (/\/(api|rpc)\b/.test(r.url()) || r.method() !== 'GET') serviceCalls.push(r.url());
  });
  await page.goto(`${base}preview/`);
  const main = page.getByRole('main');
  const role = name => page.getByRole('button', { name, exact: true }).click();
  const nav = name => page.getByRole('navigation').getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.locator('.task-card')).toHaveCount(4);
  await expect(page.locator('.role-switch [aria-pressed="true"]')).toHaveText('Public entry');
  await expect(page.locator('select')).toHaveCount(0);
  result.checks.push('Four public tasks; no preselected workspace or native select');
  for (const width of result.widths) {
    await page.setViewportSize({ width, height: 1000 });
    await role('Public entry');
    await page.screenshot({ path: path.join(artifacts, `public-${width}.png`), fullPage: true });
    for (const [id, r] of Object.entries(roles)) {
      await role(r.label);
      for (let i = 0; i < journeys[id].length; i++) {
        await page.getByRole('navigation').getByRole('button').nth(i).click();
        await expect(main.getByRole('heading', { level: 1 })).toHaveText(journeys[id][i].title);
        await expect(page.locator('.screen-content')).not.toBeEmpty();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
        await expect(page.getByRole('region', { name: 'Screen inspector' })
          .getByRole('heading', { name: 'Permission', exact: true })).toBeVisible();
        result.renders++;
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await role('Exit investor');
  await nav('Originator match');
  await main.getByRole('button', { name: /Alder Test Credit/ }).click();
  await main.getByRole('button', { name: 'Read example wallet position' }).click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Your positions');
  await main.getByRole('button', { name: 'Explore an early exit' }).click();
  for (const amount of ['0', '-1', '100001']) {
    await main.getByRole('spinbutton', { name: 'Face value to exit' }).fill(amount);
    await main.getByRole('button', { name: 'See offers', exact: true }).click();
    await expect(main.getByRole('alert')).toContainText('Enter an amount');
  }
  await main.getByRole('spinbutton', { name: 'Face value to exit' }).fill('40000');
  await main.getByRole('button', { name: 'See offers', exact: true }).click();
  await expect(main.locator('.offer')).toHaveCount(4);
  for (const width of result.widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(artifacts, `offers-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await main.locator('.offer[data-value="finance:northstar"]').click();
  await main.getByRole('button', { name: 'Review selected offer' }).click();
  await expect(main).toContainText('38,400.00');
  await expect(main).toContainText('Northstar');
  await main.getByRole('button', { name: 'Review agreement' }).click();
  await expect(main.getByRole('button', { name: 'Preview agreement signed' })).toBeDisabled();
  await main.getByRole('checkbox').check();
  await main.getByRole('button', { name: 'Preview agreement signed' }).click();
  await expect(main).toContainText('Your payout has not been made');
  await main.getByRole('button', { name: 'Preview authorization' }).click();
  await main.getByRole('button', { name: 'Preview confirmed settlement' }).click();
  await expect(main).toContainText('38,400.00');
  await expect(main).toContainText('Old investor claim discharged');
  await main.getByRole('button', { name: 'Return to positions' }).click();
  await expect(main).toContainText('60,000.00');
  await main.getByRole('button', { name: 'View agreements & history' }).click();
  const downloadPromise = page.waitForEvent('download');
  await main.getByRole('button', { name: 'Download example record' }).click();
  await (await downloadPromise).saveAs(path.join(artifacts, 'investor.txt'));
  const exported = await readFile(path.join(artifacts, 'investor.txt'), 'utf8');
  for (const text of ['38,400.00', 'Northstar', 'Not a signed legal agreement']) expect(exported).toContain(text);
  result.checks.push('Onchain match skips record link; amount limits; competing bid, agreement, payout, residual and export reconcile');
  await nav('Originator match');
  await main.getByRole('button', { name: /Birch Test Receivables/ }).click();
  await main.getByRole('button', { name: 'Continue to record linking' }).click();
  await expect(main.getByRole('button', { name: 'Link example record' })).toBeDisabled();
  await main.getByRole('checkbox').check();
  await main.getByRole('button', { name: 'Link example record' }).click();
  await main.getByRole('button', { name: 'Explore an early exit' }).click();
  await main.getByRole('spinbutton', { name: 'Face value to exit' }).fill('40000');
  await main.getByRole('button', { name: 'See offers' }).click();
  await expect(main.getByRole('alert')).toContainText('full 100,000');
  await main.getByRole('spinbutton', { name: 'Face value to exit' }).fill('100000');
  await main.getByRole('button', { name: 'See offers' }).click();
  await expect(main.locator('.offer')).toHaveCount(1);
  await expect(main.locator('.offer')).toContainText('Northstar');
  await expect(main).toContainText('Conditional registrar close');
  await nav('Originator match');
  await main.getByRole('button', { name: /Elm Test Private Credit/ }).click();
  await expect(main.getByRole('button', { name: 'Continue to record linking' })).toBeDisabled();
  await main.getByRole('button', { name: 'Choose another example fund' }).click();
  await expect(main.getByRole('button', { name: 'Read example wallet position' })).toBeEnabled();
  result.checks.push('Offchain consent; instrument route restrictions; whole-claim-only assignment; conditional integration blocking');
  for (const [id, name] of Object.entries(scenarios).filter(([id]) =>
    ['error', 'nooffers', 'expired', 'rejected', 'wallet', 'chain', 'pending', 'unready'].includes(id))) {
    await page.locator('.scenario-picker summary').click();
    await page.getByRole('button', { name, exact: true }).click();
    for (const b of await main.locator('.screen-content .actions .primary').all()) await expect(b).toBeDisabled();
    await main.locator('.scenario-state button').click();
    result.blockedScenarios++;
  }
  await role('Capital provider');
  for (let i = 0; i < 7; i++) {
    if (await main.getByRole('checkbox').count()) await main.getByRole('checkbox').check();
    await main.locator('.actions .primary').click();
  }
  await expect(main).toContainText('21,000 shares');
  await expect(main).toContainText('6,000 queued + 15,000 free');
  await page.screenshot({ path: path.join(artifacts, 'provider-records.png'), fullPage: true });
  await role('Investment firm');
  await nav('Underwriting');
  await expect(main).toContainText('40,000 face / 500,000 NAV = 8.0% exposure');
  await role('Fund or platform');
  await nav('Repayment');
  await expect(main).toContainText('39,390');
  await role('Public entry');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(/^(BUTTON|A|SUMMARY)$/);
  result.checks.push('Failure controls; provider share reconciliation; face-exposure basis; borrower repayment; keyboard focus');
  await page.goto(`${base}index.html#investor-choice`);
  await expect(page.locator('#investor-choice')).toHaveAttribute('open', '');
  await expect(page.locator('#feature-count')).toHaveText('75 of 75 screens / action groups');
  const note = page.getByRole('textbox', { name: /Review note: Exit investor: Choose how much to exit/ });
  await note.fill('<script>window.reviewLeak=true</script> review example');
  await note.blur();
  await expect(page.locator('#review-status')).toContainText('1 notes');
  await page.reload();
  await expect(note).toHaveValue('<script>window.reviewLeak=true</script> review example');
  expect(await page.evaluate(() => window.reviewLeak)).toBeUndefined();
  result.checks.push('Blueprint deep link, updated feature count and safe persistent review note');
  expect(errors).toEqual([]); expect(badResponses).toEqual([]); expect(serviceCalls).toEqual([]);
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.failure = error.message; throw error;
} finally {
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
