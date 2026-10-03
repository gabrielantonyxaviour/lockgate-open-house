import { test, expect, type Page } from '@playwright/test';
const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';
async function session(page: Page) {
  await page.route('https://**', route => route.abort());
  await page.addInitScript(({ first }) => {
    let accounts = [first];
    let chain = '0x66eee';
    const listeners: Record<string, ((value: unknown) => void)[]> = {};
    const calls: string[] = [];
    Object.assign(window, {
      __sessionCalls: calls,
      __walletEvent: (event: string, value: unknown) => {
        if (event === 'accountsChanged') accounts = value as string[];
        if (event === 'chainChanged') chain = value as string;
        for (const fn of listeners[event] || []) fn(value);
      },
      ethereum: {
        request: async ({ method }: { method: string }) => {
          calls.push(method);
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return accounts;
          if (method === 'eth_chainId') return chain;
          throw new Error(`Unexpected wallet method: ${method}`);
        },
        on: (event: string, fn: (value: unknown) => void) => { (listeners[event] ||= []).push(fn); },
        removeListener: (event: string, fn: (value: unknown) => void) => { listeners[event] = (listeners[event] || []).filter(v => v !== fn); },
      },
    });
  }, { first });
}
test('wallet reconnects without prompting and explicit disconnect persists', async ({ page }) => {
  await session(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __sessionCalls: string[] }).__sessionCalls);
  expect(calls).toContain('eth_accounts');
  expect(calls).not.toContain('eth_requestAccounts');
  await page.locator('.wallet-button').click();
  const wallet = page.getByRole('dialog', { name: 'Your wallet' });
  await expect(wallet).toContainText(first);
  await expect(wallet).toContainText('Arbitrum Sepolia');
  await wallet.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('.wallet-button')).toHaveText('Connect wallet');
  await page.reload();
  await expect(page.locator('.wallet-button')).toHaveText('Connect wallet');
  expect(await page.evaluate(() => localStorage.getItem('lockgate.wallet.connected.v1'))).toBeNull();
});
test('account and network events update the wallet panel and connection', async ({ page }) => {
  await session(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible();
  await page.evaluate(second => (window as unknown as { __walletEvent: (event: string, value: unknown) => void }).__walletEvent('accountsChanged', [second]), second);
  await expect(page.locator('.wallet-button')).toContainText('0x2222');
  await page.locator('.wallet-button').click();
  const wallet = page.getByRole('dialog', { name: 'Your wallet' });
  await expect(wallet).toContainText(second);
  await page.evaluate(() => (window as unknown as { __walletEvent: (event: string, value: unknown) => void }).__walletEvent('chainChanged', '0xa4b1'));
  await expect(wallet).toContainText('Arbitrum One');
  await expect(wallet).toContainText('Select Arbitrum Sepolia');
  await page.keyboard.press('Escape');
  await expect(wallet).toHaveCount(0);
  await expect(page.locator('.wallet-button')).toBeFocused();
  await page.evaluate(() => (window as unknown as { __walletEvent: (event: string, value: unknown) => void }).__walletEvent('accountsChanged', []));
  await expect(page.locator('.wallet-button')).toHaveText('Connect wallet');
});
