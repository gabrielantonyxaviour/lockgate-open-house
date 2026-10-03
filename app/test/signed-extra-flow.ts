import { expect, type Page } from '@playwright/test';
import { parseAbi, type Address } from 'viem';
import { DEPLOYMENT } from '../src/chain/config';
import { creditLineAbi, platformAbi } from '../src/chain/abi';
import { factoryAbi } from '../src/chain/factory-abi';
import { personas, type SignedFork } from './signed-fork';
export async function issuerEligibility(fork: SignedFork, platform: Address, issuer: Page, confirm: (p: Page) => Promise<void>) {
  await issuer.getByLabel('Wallet eligibility', { exact: true }).fill(personas.investor.address);
  await issuer.getByRole('combobox', { name: 'Eligibility', exact: true }).click();
  await issuer.getByRole('option', { name: 'Blocked', exact: true }).click();
  await issuer.getByRole('button', { name: 'Review eligibility change' }).click(); await confirm(issuer);
  const share = await fork.client.readContract({ address: platform, abi: platformAbi, functionName: 'share' });
  const blockedAbi = parseAbi(['function blocked(address) view returns(bool)']);
  expect(await fork.client.readContract({ address: share, abi: blockedAbi, functionName: 'blocked', args: [personas.investor.address] })).toBe(true);
  await issuer.getByRole('combobox', { name: 'Eligibility', exact: true }).click();
  await issuer.getByRole('option', { name: 'Allowed', exact: true }).click();
  await issuer.getByRole('button', { name: 'Review eligibility change' }).click(); await confirm(issuer);
  expect(await fork.client.readContract({ address: share, abi: blockedAbi, functionName: 'blocked', args: [personas.investor.address] })).toBe(false);
}
export async function operatorExtras(fork: SignedFork, platform: Address, operator: Page,
  confirm: (p: Page) => Promise<void>, fund: (p: Page, title: string, amount: string) => Promise<void>) {
  await operator.getByLabel('Grace for new advances · seconds').fill('45');
  await operator.getByRole('button', { name: 'Review grace update' }).click(); await confirm(operator);
  expect(await fork.client.readContract({ address: DEPLOYMENT.creditLine, abi: creditLineAbi, functionName: 'grace' })).toBe(45n);
  await operator.getByRole('combobox', { name: 'Platform', exact: true }).click();
  await operator.getByRole('option', { name: 'Signed wallet verification', exact: true }).click();
  await operator.getByLabel('New limit · USDG').fill('90');
  await operator.getByRole('button', { name: 'Review platform terms' }).click(); await confirm(operator);
  expect(await fork.client.readContract({ address: DEPLOYMENT.creditLine, abi: creditLineAbi, functionName: 'limitOf', args: [platform] })).toBe(90_000_000n);
  const before = await fork.client.readContract({ address: DEPLOYMENT.factory, abi: factoryAbi, functionName: 'allFunds' });
  await operator.goto('/#/create');
  await operator.getByLabel('Platform name', { exact: true }).fill('Signed UI registration');
  await operator.getByRole('textbox', { name: /^Issuer wallet/ }).fill(personas.issuer.address);
  await operator.getByRole('button', { name: 'Review platform creation' }).click(); await confirm(operator);
  const after = await fork.client.readContract({ address: DEPLOYMENT.factory, abi: factoryAbi, functionName: 'allFunds' });
  expect(after.length).toBe(before.length + 1);
  await operator.goto(`/#/platform/${after.at(-1)}`);
  await fund(operator, 'Post platform reserve', '0.1');
}
