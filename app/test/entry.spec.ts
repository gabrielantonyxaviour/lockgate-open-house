import { test, expect } from '@playwright/test';

test('public overview explains the product before wallet or chain reads complete', async ({ page }) => {
  await page.route('https://**', route => route.abort());
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: /Your capital.*On your timeline/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inside the exit rail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /I want an earlier exit/ })).toHaveCount(0);
});

test('wallet connection reveals both choices without preselecting a role', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { ethereum: {
    request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x66eee' : ['0x1111111111111111111111111111111111111111'],
    on: () => {}, removeListener: () => {},
  } }));
  await page.route('https://**', route => route.abort());
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/choose$/);
  await expect(page.getByRole('link', { name: /I want an earlier exit/ })).toHaveAttribute('href', '#/start/investor');
  await expect(page.getByRole('link', { name: /I want to offer earlier exits/ })).toHaveAttribute('href', '#/start/issuer');
});

for (const role of ['investor', 'issuer'] as const) {
  test(`${role} learns the benefit before connecting a wallet`, async ({ page }) => {
    await page.goto(`/?preview=1#/start/${role}`);
    await expect(page).toHaveURL(new RegExp(`#/start/${role}$`));
    await expect(page.getByRole('heading', { name: role === 'investor' ? 'Choose when your capital comes back.' : 'Give your investors another option.' })).toBeVisible();
    await expect(page.getByRole('button', { name: role === 'investor' ? 'Connect my wallet' : 'Connect issuer wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    if (role === 'issuer') await expect(page.getByRole('link', { name: /Prepare a local facility draft/ })).toHaveAttribute('href', '#/onboarding');

  });
}

for (const width of [375, 768, 1440]) {
  test(`entry and both journeys fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/start/investor', '/start/issuer']) {
      await page.goto(`/?preview=1#${route}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  });
}
