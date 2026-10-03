import { describe, expect, it } from 'vitest';
import { parseAmount, assertFreshQuote } from '../src/chain/amounts';
import { assertWalletChain } from '../src/chain/wallet';
import { buildAction } from '../src/chain/actions';
import { DEPLOYMENT } from '../src/chain/config';
import type { Snapshot } from '../src/chain/model';
const owner='0x1111111111111111111111111111111111111111';
const outsider='0x2222222222222222222222222222222222222222';
function snapshot():Snapshot {
 return {mode:'live',blockNumber:1n,observedAt:Date.now(),account:owner,usdgBalance:100_000_000n,roles:{operator:true,issuerPlatforms:[DEPLOYMENT.platform],partnerVaults:[DEPLOYMENT.vaultA]},warnings:[],platforms:[{address:DEPLOYMENT.platform,name:'Sandbox',share:outsider,issuer:owner,nav:1_000_000n,cash:0n,nextWindow:0n,windowInterval:600n,gated:false,queueLength:1n,queuedValue:1_000_000n,limit:10_000_000n,exposure:0n,reserve:1_000_000n,holding:10n**18n,blocked:false,requests:[{id:1n,owner,shares:10n**18n,navValue:1_000_000n,requestedAt:1n,status:'Queued',advanceId:0n}],settlement:{cashBalance:0n,repayFirst:0n,queuePayable:0n,queueShortfall:1_000_000n}}],creditLine:{owner,capital:1n,outstanding:0n,totalExposure:0n,earnedFees:0n,lateOutstanding:0n,utilizationBps:0,paused:false,advances:[]},vaults:[{address:DEPLOYMENT.vaultA,name:'Partner',owner,idle:1_000_000n,reserveCash:0n,outstandingPrincipal:0n,totalAssets:1_000_000n,paused:false,mandate:{partner:owner,signer:owner,minFeeBps:0,maxTenor:1n,concentrationBps:10000,expiry:1n},approvedPlatforms:[],advanceCount:0n,proposals:[]}]};
}
describe('exact token amount boundaries',()=>{
 it('preserves six-decimal units and eighteen-decimal shares',()=>{expect(parseAmount('0.000001')).toBe(1n);expect(parseAmount('0.000000000000000001',18)).toBe(1n);expect(parseAmount('9007199254740993.123456')).toBe(9007199254740993123456n);});
 it.each(['0','-1','+1',' 1','1 ','1e6','NaN','0.0000001','01','1.','1,000'])('rejects %s rather than rounding',value=>expect(()=>parseAmount(value)).toThrow());
 it('refuses uint256 overflow',()=>expect(()=>parseAmount(((1n<<256n)).toString(),0)).toThrow());
 it('rejects old and future quotes',()=>{expect(()=>assertFreshQuote(0,60001)).toThrow();expect(()=>assertFreshQuote(2,1)).toThrow();});
});
describe('transaction authority boundaries',()=>{
 it('allows zero credit limits while preserving positive transfer amounts',()=>{const s=snapshot();expect(buildAction({kind:'setSourceTerms',platform:DEPLOYMENT.platform,amount:'0',reserveBps:750,riskBps:0},s,owner).args).toEqual([DEPLOYMENT.platform,0n,750,0]);expect(buildAction({kind:'vaultSetPlatform',vault:DEPLOYMENT.vaultA,platform:DEPLOYMENT.platform,approved:false,amount:'0',reserveBps:750,checkGate:true,maxNavAge:60n},s,owner).args[2]).toBe(0n);expect(()=>buildAction({kind:'deposit',platform:DEPLOYMENT.platform,amount:'0'},s,owner)).toThrow('positive');});
 it('refuses mainnet and Ethereum Sepolia',()=>{expect(()=>assertWalletChain(42161)).toThrow();expect(()=>assertWalletChain(11155111)).toThrow();expect(()=>assertWalletChain(421614)).not.toThrow();});
 it('never allows preview broadcast',()=>{const s=snapshot();s.mode='preview';expect(()=>buildAction({kind:'pause'},s,owner)).toThrow('Preview');});
 it('does not trust role display flags as authority',()=>{const s=snapshot();s.account=outsider;expect(()=>buildAction({kind:'pause'},s,outsider)).toThrow('owner');expect(()=>buildAction({kind:'setGated',platform:DEPLOYMENT.platform,gated:true},s,outsider)).toThrow('issuer');});
 it('requires request ownership and queued status',()=>{const s=snapshot();s.platforms[0].requests[0].owner=outsider;expect(()=>buildAction({kind:'cancel',platform:DEPLOYMENT.platform,requestId:1n},s,owner)).toThrow('owner');s.platforms[0].requests[0].owner=owner;s.platforms[0].requests[0].status='Advanced';expect(()=>buildAction({kind:'cancel',platform:DEPLOYMENT.platform,requestId:1n},s,owner)).toThrow();});
 it('only approves exact USDG needed and never share escrow',()=>{const s=snapshot();expect(buildAction({kind:'deposit',platform:DEPLOYMENT.platform,amount:'1.25'},s,owner).approval).toEqual({spender:DEPLOYMENT.platform,amount:1_250_000n});expect(buildAction({kind:'requestRedeem',platform:DEPLOYMENT.platform,amount:'1'},s,owner).approval).toBeUndefined();});
 it('limits exit shares and minimum output',()=>{const s=snapshot();expect(()=>buildAction({kind:'exitNow',platform:DEPLOYMENT.platform,amount:'2',minUsdgOut:1n,quotedAt:Date.now()},s,owner)).toThrow('balance');expect(()=>buildAction({kind:'exitNow',platform:DEPLOYMENT.platform,amount:'1',minUsdgOut:0n,quotedAt:Date.now()},s,owner)).toThrow();});
 it('cannot withdraw another partners funds or locked capital',()=>{const s=snapshot();s.account=outsider;expect(()=>buildAction({kind:'vaultWithdraw',vault:DEPLOYMENT.vaultA,amount:'1'},s,outsider)).toThrow('partner owner');s.account=owner;expect(()=>buildAction({kind:'vaultWithdraw',vault:DEPLOYMENT.vaultA,amount:'2'},s,owner)).toThrow('idle');});
 it('rejects unknown actions at the runtime boundary',()=>expect(()=>buildAction({kind:'transferOwnership'} as never,snapshot(),owner)).toThrow());
 it('validates configuration caps and requires owner controls',()=>{
  const s=snapshot();
  expect(()=>buildAction({kind:'setCaps',maxUtilizationBps:10001,maxConcentrationBps:10000},s,owner)).toThrow();
  expect(buildAction({kind:'setCaps',maxUtilizationBps:8000,maxConcentrationBps:10000},s,owner).args).toEqual([8000,10000]);
  s.account=outsider;expect(()=>buildAction({kind:'registerSource',platform:outsider,amount:'100',reserveBps:750},s,outsider)).toThrow('owner');
 });
 it('supports issuer eligibility without granting it to an operator alone',()=>{const s=snapshot();s.platforms[0].issuer=outsider;expect(()=>buildAction({kind:'setAllowlist',platform:DEPLOYMENT.platform,account:outsider,allowed:true},s,owner)).toThrow('issuer');});
 it('bounds mandate tenor and platform reserve rates',()=>{const s=snapshot();expect(()=>buildAction({kind:'vaultSetMandate',vault:DEPLOYMENT.vaultA,minFeeBps:1,maxTenor:1n<<64n,concentrationBps:10000,expiry:1n},s,owner)).toThrow();expect(()=>buildAction({kind:'vaultSetPlatform',vault:DEPLOYMENT.vaultA,platform:DEPLOYMENT.platform,amount:'100',approved:true,reserveBps:10001,checkGate:true,maxNavAge:60n},s,owner)).toThrow();});

});
