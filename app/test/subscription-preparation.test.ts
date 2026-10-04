import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { createDemoGateway } from '../src/services/demo-gateway';
import { DemoTransport, stateSchema } from '../src/services/demo-transport';
import type { DemoState, PreparedSubscription } from '../src/demo/types';
import { subscriptionAgreementText } from '../../harness/src/demo/legal-documents';

const wallet = '0x6ae9ec7cf89266652373a9831ec5f8ca84f96e05' as Address;
const otherWallet = '0x1111111111111111111111111111111111111111' as Address;
const vault = '0x2222222222222222222222222222222222222222' as Address;
const otherVault = '0x3333333333333333333333333333333333333333' as Address;
const policy = 'Exact Northstar TEST vehicle policy.';
const policyHash = keccak256(stringToHex(policy));
const expiresAt = () => new Date(Date.now() + 600_000).toISOString();

function document(address: Address): PreparedSubscription {
 const expiry = expiresAt();
 const message = subscriptionAgreementText({
  documentId:'SUBSCRIPTION-LETTER-TEST',version:'2',createdAt:new Date().toISOString(),expiresAt:expiry,
  fundingExpiresAt:new Date(Date.now() + 3_600_000).toISOString(),nonce:'subscription-nonce-test',
  profile:{id:'lucas-chen',name:'Lucas Chen',jurisdiction:'Singapore',identityRef:'TEST-IDENTITY-LUCAS',identityHash:keccak256(stringToHex('TEST-IDENTITY-LUCAS')),wallet:address},
  asset:{name:'Lockgate custom TEST USDG',symbol:'USDG',address:otherVault,chainId:421614,chainName:'Arbitrum Sepolia',decimals:6,kind:'custom-test-usdg'},
  vehicle:{id:'northstar',name:'Northstar Investment Firm Liquidity Vehicle',firm:'Northstar Investment Firm',address:vault,manager:otherWallet,termsHash:policyHash,termsText:policy},
  amount:1_000_000_000n,
 });
 return {message,digest:keccak256(stringToHex(message)),vault,amount:'1000',termsHash:policyHash,signerName:'Lucas Chen',expiresAt:expiry,documentId:'SUBSCRIPTION-LETTER-TEST',version:'2'};
}

function prepare(account: Address, response: PreparedSubscription, vehicleOverrides: Record<string, unknown> = {}) {
 const gateway = createDemoGateway();
 const state = stateSchema.parse({
  profile:{roles:['provider'],activeRole:'provider',identity:{name:'Lucas Chen'}},
  positions:[],positionStatus:'empty',
  vehicles:[{id:'northstar',name:'Northstar Investment Firm Liquidity Vehicle',firm:'Northstar Investment Firm',cash:'0',nav:'0',policy:'TEST mandate',minimum:'100',eligible:true,eligibilityStatus:'Eligible',address:vault,policyHash,policyText:policy,...vehicleOverrides}],
  receipts:[],setup:{gas:'0',usdg:'0',canMint:false,canFund:false},deploymentReady:true,
 }) as DemoState;
 Object.assign(gateway,{account,state});
 vi.spyOn(DemoTransport.prototype,'request').mockResolvedValue(response);
 return gateway.prepareSubscription('northstar','1000');
}

afterEach(() => vi.restoreAllMocks());

describe('subscription preparation checks the exact reviewed package', () => {
 it('accepts a checksummed letter for the same lowercase wallet', async () => {
  const response = document(getAddress(wallet));
  await expect(prepare(wallet,response)).resolves.toEqual(response);
 });
 it('accepts a lowercase letter for the same checksummed wallet', async () => {
  const response = document(wallet);
  await expect(prepare(getAddress(wallet),response)).resolves.toEqual(response);
 });
 it('rejects a different signer wallet even if the current wallet appears elsewhere', async () => {
  const response = document(otherWallet);
  response.message += `\nReference account: ${wallet}`;
  response.digest = keccak256(stringToHex(response.message));
  await expect(prepare(wallet,response)).rejects.toThrow('Subscription letter does not match');
 });
 it.each([
  ['changed text', (item:PreparedSubscription) => {item.message += ' Changed.';}],
  ['changed amount', (item:PreparedSubscription) => {item.amount = '1001';}],
  ['changed vault', (item:PreparedSubscription) => {item.vault = otherVault;}],
  ['changed policy hash', (item:PreparedSubscription) => {item.termsHash = keccak256(stringToHex('other policy')) as Hex;}],
  ['missing policy text', (item:PreparedSubscription) => {item.message = item.message.replace(policy,'other policy');item.digest = keccak256(stringToHex(item.message));}],
  ['expired letter', (item:PreparedSubscription) => {item.expiresAt = new Date(Date.now() - 1).toISOString();}],
 ])('rejects %s', async (_,change) => {
  const response = document(getAddress(wallet));
  change(response);
  await expect(prepare(wallet,response)).rejects.toThrow('Subscription letter does not match');
 });
 it('rejects a changed reviewed vehicle policy', async () => {
  await expect(prepare(wallet,document(getAddress(wallet)),{policyHash:keccak256(stringToHex('new vehicle policy'))})).rejects.toThrow('Subscription letter does not match');
 });
});
