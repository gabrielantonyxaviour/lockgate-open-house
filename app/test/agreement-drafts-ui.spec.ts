import { expect, test, type Page } from '@playwright/test';
// UI-only gateway fixtures. No wallet signing or chain transactions are performed.
const digest = `0x${'a'.repeat(64)}`;
const wallet = `0x${'1'.repeat(40)}`;
const text = 'LOCKGATE — TEST EXECUTION DOCUMENT\nReview fixture\n\n' + 'The selected parties review these exact TEST terms before signing. '.repeat(90);
async function fixture(page: Page, role: 'investor' | 'provider', changed = false) {
  await page.addInitScript(() => {
    localStorage.setItem('lockgate.wallet.connected.v1', '1');
    Object.assign(window, { ethereum: { request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x66eee' : ['0x1111111111111111111111111111111111111111'], on() {}, removeListener() {} } });
  });
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const draft = { id: 'draft-test', kind: role === 'investor' ? 'exit' : 'subscription', title: 'Saved TEST agreement', text, digest, version: '2', createdAt: new Date().toISOString(), expiresAt, positionId: 'cedar', vehicleId: 'northstar', amount: '1000' };
  const agreement = { id: draft.id, title: draft.title, text, digest, version: '2', signed: false, accepted: false };
  const offer = { id: 'offer-test', positionId: 'cedar', vehicleId: 'northstar', firm: 'Northstar Investment Firm', vehicle: 'Northstar Credit Vehicle', route: 'purchase', amount: '1000', payout: '980', fee: '20', residual: '0', expiresAt, agreement };
  const prepared = { documentId: draft.id, message: text, digest, version: '2', expiresAt, amount: '1000', signerName: 'Lucas Chen', vault: wallet, termsHash: digest };
  const state = { profile: { roles: [role], activeRole: role, identity: { id: 'lucas-chen', name: 'Lucas Chen', jurisdiction: 'Singapore', fixtureCase: 'match' } }, positions: [{ id: 'cedar', name: 'Cedar Income Fund', originator: 'Cedar Income Trust', instrument: 'Fund interest', available: '1000', partial: true }], positionStatus: 'matched', vehicles: [{ id: 'northstar', name: 'Northstar Credit Vehicle', firm: 'Northstar Investment Firm', nav: '500000', cash: '400000', minimum: '100', eligible: true, policy: 'TEST mandate', eligibilityStatus: 'Eligible' }], receipts: [], agreements: [], documentDrafts: [], setup: { gas: '0', usdg: '0', canMint: false, canFund: false }, deploymentReady: true };
  const result = role === 'investor' ? { kind: 'exit', offer } : { kind: 'subscription', prepared, vehicleId: 'northstar', amount: '1000' };
  await page.route('**/src/services/demo-gateway.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `const state=${JSON.stringify(state)},draft=${JSON.stringify(draft)},result=${JSON.stringify(result)};state.documentDrafts=JSON.parse(sessionStorage.getItem('ui-drafts')||'[]');export function createDemoGateway(){return {publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0'}),authenticate:async()=>state,refresh:async()=>state,offers:async()=>[${JSON.stringify(offer)}],prepareSubscription:async()=>(${JSON.stringify(prepared)}),saveDocumentDraft:async(kind,id)=>{if(kind!==draft.kind||id!==draft.id)throw Error('Wrong draft');state.documentDrafts=[draft];sessionStorage.setItem('ui-drafts',JSON.stringify(state.documentDrafts));},resumeDocumentDraft:async()=>{${changed ? "throw Error('This draft has been replaced. Review current terms.');" : 'return result;'}},renewDocumentDraft:async()=>{document.body.dataset.renewed='true';return result;}}}` }));
  await page.goto('/'); await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.evaluate(path => { location.hash = path; }, role === 'investor' ? '/positions' : '/vehicles');
  if (role === 'investor') {
    await page.getByRole('button', { name: 'Explore an exit' }).click(); await page.getByLabel('Exit amount').fill('1000');
    await page.getByRole('button', { name: 'See eligible offers' }).click(); await page.getByRole('button', { name: 'Review offer' }).click();
  } else {
    await page.getByRole('button', { name: 'View vehicle' }).click(); await page.getByLabel('Subscription amount').fill('1000');
    await page.getByRole('button', { name: 'Review terms' }).click();
  }
}
for (const width of [375,768,1440]) for (const role of ['investor', 'provider'] as const) test(`${role} at ${width}px saves unsigned terms, exports, reloads and resumes`, async ({ page }) => {
  await page.setViewportSize({width,height:1000});
  await fixture(page, role);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(process.env.LOCKGATE_VISUAL_REVIEW==='1'){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/lockgate-review-${role}-${width}.png`});}
  await expect(page.getByRole('region', { name: 'Agreement document viewer' })).toBeVisible();
  await expect(page.getByRole('button', { name: role === 'investor' ? 'Sign agreement' : 'Sign subscription' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save & agree later' }).click();
  await expect(page.getByRole('heading', { name: 'Saved for later' })).toBeVisible();
  await expect(page.getByText('Unsigned draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View / export saved draft' }).click();
  await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '/agreements'; });
  await page.getByRole('button', { name: 'Resume review' }).click();
  await expect(page.getByRole('heading', { name: role === 'investor' ? 'Review your exit.' : 'Review your subscription.', exact: true })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});
test('changed draft can recover to current terms without signing', async ({ page }) => {
  await fixture(page, 'provider', true);
  await page.getByRole('button', { name: 'Save & agree later' }).click();
  await page.getByRole('button', { name: 'Resume review' }).click();
  await expect(page.getByRole('heading', { name: 'This draft needs another review.' })).toBeVisible();
  await page.getByRole('button', { name: 'Review current terms' }).click();
  await expect(page.getByRole('heading', { name: 'Review your subscription.', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-renewed', 'true');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});
