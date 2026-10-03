import { expect, type Page } from '@playwright/test';
import type { Address } from 'viem';
import { facilityAbi } from '../src/chain/facility-abi';
import { personas, type SignedFork } from './signed-fork';
export async function facilityFlow(fork: SignedFork, facility: Address, partner: Page, operator: Page,
  fund: (page: Page, title: string, amount: string) => Promise<void>, confirm: (page: Page) => Promise<void>, capture: (page: Page, name: string) => Promise<void>) {
  await partner.goto('/#/capital');
  await partner.getByRole('textbox', { name: 'Facility lender wallet' }).fill(personas.partner.address);
  await partner.getByRole('button', { name: 'Review lender access' }).click(); await confirm(partner);
  expect(await fork.client.readContract({ address: facility, abi: facilityAbi, functionName: 'approvedLender', args: [personas.partner.address] })).toBe(true);
  await fund(partner, 'Deposit senior capital', '0.1');
  await partner.getByRole('combobox', { name: 'Capital tranche' }).click();
  await partner.getByRole('option', { name: 'Junior', exact: true }).click();
  await fund(partner, 'Deposit junior capital', '0.4');
  await capture(partner, 'facility-lender-deposits');
  await operator.goto('/#/capital');
  const unavailableDeposit = operator.locator('.funding-form').filter({ has: operator.getByRole('textbox', { name: 'Deposit senior capital amount' }) });
  await expect(unavailableDeposit.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  await fund(operator, 'Draw facility capital', '0.3');
  expect((await fork.client.readContract({ address: facility, abi: facilityAbi, functionName: 'accounting' })).drawn).toBe(300_000n);
  await fork.rpc('evm_increaseTime', [8000]); await fork.rpc('evm_mine');
  await operator.goto('/#/capital');
  await operator.getByRole('button', { name: 'Update facility health' }).click(); await confirm(operator);
  await fund(operator, 'Repay facility', '0.31');
  expect((await fork.client.readContract({ address: facility, abi: facilityAbi, functionName: 'accounting' })).drawn).toBe(0n);
  await capture(operator, 'facility-borrower-repaid');
  await partner.goto('/#/capital');
  await partner.getByRole('button',{name:'Refresh chain data'}).click();
  await expect(partner.getByRole('button',{name:'Refresh chain data'})).toBeEnabled({timeout:45000});
  await partner.getByRole('combobox', { name: 'Capital tranche' }).click();
  await partner.getByRole('option', { name: 'Senior', exact: true }).click();
  await expect(partner.getByRole('button', { name: 'Claim senior interest' })).toBeEnabled({timeout:30000});
  await partner.getByRole('button', { name: 'Claim senior interest' }).click(); await confirm(partner);
  await fund(partner, 'Withdraw senior capital', '0.01');
  await partner.getByRole('combobox', { name: 'Capital tranche' }).click();
  await partner.getByRole('option', { name: 'Junior', exact: true }).click();
  await expect(partner.getByRole('button', { name: 'Claim junior interest' })).toBeEnabled({timeout:30000});
  await partner.getByRole('button', { name: 'Claim junior interest' }).click(); await confirm(partner);
  await fund(partner, 'Withdraw junior capital', '0.01');
  expect(await fork.client.readContract({ address: facility, abi: facilityAbi, functionName: 'solvent' })).toBe(true);
  await capture(partner, 'facility-lender-claims');
}
export async function prepareFacilityRecovery(operator: Page, partner: Page,
  fund: (page: Page, title: string, amount: string) => Promise<void>) {
  await partner.goto('/#/capital');
  await partner.getByRole('combobox', { name: 'Capital tranche' }).click();
  await partner.getByRole('option', { name: 'Junior', exact: true }).click();
  await fund(partner, 'Withdraw junior capital', '0.35');
  await operator.goto('/#/capital');
  await fund(operator, 'Draw facility capital', '0.12');
}
export async function recognizeFacilityLoss(fork: SignedFork, facility: Address, operator: Page,
  confirm: (page: Page) => Promise<void>, capture: (page: Page, name: string) => Promise<void>) {
  await operator.goto('/#/capital');
  await operator.getByRole('button', { name: 'Update facility health' }).click(); await confirm(operator);
  expect((await fork.client.readContract({ address: facility, abi: facilityAbi, functionName: 'accounting' })).recovery).toBe(true);
  await operator.getByRole('button', { name: 'Recognize loss' }).click(); await confirm(operator);
  const accounting = await fork.client.readContract({ address: facility, abi: facilityAbi, functionName: 'accounting' });
  expect(accounting.drawn).toBe(0n);
  expect(accounting.juniorDeficit).toBeGreaterThan(0n);
  expect(accounting.seniorDeficit).toBeGreaterThan(0n);
  await capture(operator, 'facility-loss-waterfall');
}
