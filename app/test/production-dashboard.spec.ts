import { expect, test } from '@playwright/test';

const canonical = 'https://openhouse.lockgate.finance';

test('deployed public dashboard renders current chain metrics at three widths', async ({ page }) => {
  test.skip(process.env.BASEURL !== canonical, 'Run explicitly against the canonical production URL.');
  test.setTimeout(90_000);
  const errors: string[] = [];
  const localRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(request.url())) localRequests.push(request.url());
  });
  const response = await page.goto(canonical, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'An earlier exit, on your terms.' })).toBeVisible();
  const metrics = page.locator('.dg-public-metrics');
  await expect(metrics).toContainText('Supported originators5', { timeout: 45_000 });
  await expect(metrics).toContainText('Investment firms5');
  await expect(metrics).toContainText('Available cash');
  await expect(metrics).not.toContainText('Public metrics are unavailable');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByRole('heading', { name: 'An earlier exit, on your terms.' })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(localRequests).toEqual([]);
});
