import { test, expect, type Page } from '@playwright/test';

const platform = '0x80A66AE4Ce50724b4C9aDb3CAE9c042DFEf51F25';
const routes = ['/overview', '/platforms', '/positions', '/activity', '/issuer', '/operations',
  '/judge', '/create', '/capital', '/approvals', '/onboarding', '/integration', '/settings', `/platform/${platform}`, `/exit/${platform}`, '/advance/1'];
const preview = (route: string) => `/?preview=1#${route}`;
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function noOverflow(page: Page, route: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { level: 1 }), `Route ${route} should remain rendered`).toBeVisible();
}

for (const width of [375, 768, 1440]) {
  test(`every screen remains usable at ${width}px in explicit read-only preview`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(preview(route));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/illustrative|preview/i).first()).toBeVisible();
      await test.step(`No document overflow on ${route}`, () => noOverflow(page, route));
    }
  });
}

test('preview quotes cannot open or submit a transaction', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { __walletCalls: calls, ethereum: {
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === 'eth_chainId') return '0x66eee';
        return [];
      }, on: () => {}, removeListener: () => {},
    } });
  });
  await page.goto(preview(`/exit/${platform}`));
  await page.getByRole('textbox', { name: 'Shares to exit' }).fill('100');
  await expect(page.getByText('Illustrative quote only.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Review early exit|Preview only/ })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(preview('/operations'));
  await expect(page.getByRole('button', { name: 'Pause new advances' })).toBeDisabled();
  expect(await page.evaluate(() => {
    const calls = (window as unknown as { __walletCalls: string[] }).__walletCalls;
    return calls.filter(method => /sendTransaction|signTypedData|personal_sign/.test(method));
  })).toEqual([]);
});

test('a disconnected browser receives an actionable wallet explanation', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByText('No wallet connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Connect wallet/, exact: true }).first().click();
  await expect(page.getByText(/install.*wallet|wallet.*extension|no.*wallet|compatible.*wallet/i).first()).toBeVisible();
});

test('invalid platform plans cannot pass readiness or export', async ({ page }) => {
  await page.goto(preview('/onboarding'));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Platform details', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '5. Review', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export platform plan' })).toHaveCount(0);
  await expect(page.getByText('Enter a valid issuer wallet address.', { exact: true })).toBeVisible();
});

test('valid local plans persist without any network submission', async ({ page }) => {
  const submissions: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST') submissions.push(request.url());
  });
  await page.goto(preview('/onboarding'));
  await page.getByLabel('Legal entity name', { exact: false }).fill('Harbour Credit Pte Ltd');
  await page.getByLabel('Platform name', { exact: false }).fill('Harbour Income');
  await page.getByLabel('Issuer wallet', { exact: false }).fill('0xc37f3cC9C57F647212894a262F27fA21A371a752');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Requested facility limit', { exact: false }).fill('1000');
  await page.getByLabel('Target repayment tenor', { exact: false }).fill('30');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Planned platform reserve', { exact: false }).fill('75');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved on this device');
  await page.reload();
  await expect(page.getByLabel('Planned platform reserve', { exact: false })).toHaveValue('75');
  await page.getByRole('button', { name: '5. Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export platform plan' })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export platform plan' }).click();
  expect((await download).suggestedFilename()).toBe('lockgate-platform-plan.json');
  await expect(page.getByRole('status')).toContainText('No application was submitted');
  expect(submissions).toEqual([]);
});

test('display preferences persist and change application presentation', async ({ page }) => {
  await page.goto(preview('/settings'));
  await choose(page, 'Table spacing', 'Compact');
  await choose(page, 'Number display', 'Plain · 1000.00');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Table spacing', exact: true })).toHaveText('Compact');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.goto(preview('/overview'));
  await expect(page.getByText('7600.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('7,600.00', { exact: true })).toHaveCount(0);
});

test('screen search supports keyboard entry, filtering, escape and focus restoration', async ({ page }) => {
  await page.goto(preview('/overview'));
  const trigger = page.getByRole('button', { name: /Find a screen/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Find a screen' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search screens' })).toBeFocused();
  await page.keyboard.type('integration');
  await expect(dialog.getByRole('link', { name: 'Integration & system' })).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('/');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
});

test('mobile navigation closes with Escape and restores trigger focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(preview('/overview'));
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeHidden();
});

test('skip link focuses the page content without changing the active route', async ({ page }) => {
  await page.goto(preview('/platforms'));
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/#\/platforms$/);
});

test('styled select supports keyboard options, Escape and focus restoration', async ({ page }) => {
  await page.goto(preview('/settings'));
  const trigger = page.getByRole('combobox', { name: 'Table spacing', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Comfortable', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Compact', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Compact');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('select:visible')).toHaveCount(0);
});

test('observer network selection never presents Sepolia balances on Arbitrum One', async ({ page }) => {
  await page.route('https://sepolia-rollup.arbitrum.io/**', route => route.abort());
  await page.goto(preview('/overview'));
  await choose(page, 'Network', 'Arbitrum One');
  await expect(page.getByRole('heading', { name: 'The exit desk is coming to Arbitrum One.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Capital in motion.' })).toHaveCount(0);
  await expect(page).toHaveURL(/network=42161/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Network', exact: true })).toHaveText('Arbitrum One');
  await choose(page, 'Network', 'Arbitrum Sepolia');
  await expect(page.getByRole('combobox', { name: 'Network', exact: true })).toHaveText('Arbitrum Sepolia');
  await expect(page.getByRole('heading', { name: 'The exit desk is coming to Arbitrum One.' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Chain data unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Capital in motion.' })).toHaveCount(0);
  await expect(page.getByText(/Illustrative data/)).toHaveCount(0);
});

for (const reject of [false, true]) {
  test(`connected wallet network ${reject ? 'rejection retains current selection' : 'switch uses Arbitrum One chain ID'}`, async ({ page }) => {
    await page.addInitScript(({ reject }) => {
      let chain = '0x66eee';
      const switches: string[] = [];
      Object.assign(window, { __switches: switches, ethereum: {
        request: async ({ method, params }: { method: string; params?: { chainId: string }[] }) => {
          if (method === 'eth_requestAccounts') return ['0xc37f3cC9C57F647212894a262F27fA21A371a752'];
          if (method === 'eth_chainId') return chain;
          if (method === 'wallet_switchEthereumChain') {
            if (reject) throw { code: 4001, message: 'Wallet request rejected.' };
            chain = params![0].chainId; switches.push(chain); return null;
          }
          throw new Error(`Unexpected wallet method: ${method}`);
        }, on: () => {}, removeListener: () => {},
      } });
    }, { reject });
    await page.goto(preview('/settings'));
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible();
    await choose(page, 'Network', 'Arbitrum One');
    if (reject) {
      await expect(page.getByRole('combobox', { name: 'Network', exact: true })).toHaveText('Arbitrum Sepolia');
      await expect(page.getByRole('alert')).toContainText(/reject/i);
    } else {
      await expect(page.getByRole('heading', { name: 'The exit desk is coming to Arbitrum One.' })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __switches: string[] }).__switches)).toEqual(['0xa4b1']);
    }
  });
}

test('header controls share geometry and reduced motion keeps menus still', async ({ page }) => {
  await page.goto(preview('/overview'));
  const network = page.getByRole('combobox', { name: 'Network', exact: true });
  const wallet = page.getByRole('button', { name: 'Connect wallet', exact: true });
  const geometry = (element: Element) => ({ radius: getComputedStyle(element).borderRadius, height: element.getBoundingClientRect().height });
  expect(await network.evaluate(geometry)).toEqual(await wallet.evaluate(geometry));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await network.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await network.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-input', 'keyboard');
  await expect(page.getByRole('option', { name: 'Arbitrum Sepolia', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(network).toBeFocused();
});
