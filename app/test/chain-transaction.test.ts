import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Address,Hash} from 'viem';
const mocks=vi.hoisted(()=>({getChainId:vi.fn(),getBlockNumber:vi.fn(),readContract:vi.fn(),simulateContract:vi.fn(),wait:vi.fn(),quoteExit:vi.fn(),quoteRequest:vi.fn(),read:vi.fn(),wallet:vi.fn(),write:vi.fn()}));
vi.mock('../src/chain/client',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/chain/client')>();
 return {...actual,publicClient:{getChainId:mocks.getChainId,getBlockNumber:mocks.getBlockNumber,readContract:mocks.readContract,simulateContract:mocks.simulateContract,waitForTransactionReceipt:mocks.wait},quoteExit:mocks.quoteExit,quoteRequest:mocks.quoteRequest,read:mocks.read};
});
vi.mock('../src/chain/wallet',()=>({authorizedWallet:mocks.wallet}));
import {sendAction} from '../src/chain/actions';
import {approveProposal,parseProposal,verifyProposal} from '../src/chain/proposals';
import {DEPLOYMENT} from '../src/chain/config';
import type {Action,Snapshot,TransactionState} from '../src/chain/model';
const owner:Address='0x1111111111111111111111111111111111111111';
const signer:Address='0x2222222222222222222222222222222222222222';
const outsider:Address='0x3333333333333333333333333333333333333333';
const hash=`0x${'ab'.repeat(32)}` as Hash;
const digest=`0x${'cd'.repeat(32)}` as Hash;
function snapshot():Snapshot {
 return {mode:'live',blockNumber:1n,observedAt:Date.now(),account:owner,usdgBalance:100_000_000n,roles:{operator:true,issuerPlatforms:[DEPLOYMENT.platform],partnerVaults:[]},warnings:[],vaults:[],platforms:[{address:DEPLOYMENT.platform,name:'QA platform',share:outsider,issuer:owner,nav:1_000_000n,cash:0n,nextWindow:0n,windowInterval:600n,gated:false,queueLength:1n,queuedValue:1_000_000n,limit:10_000_000n,exposure:0n,reserve:1_000_000n,holding:10n**18n,blocked:false,requests:[{id:1n,owner,shares:10n**18n,navValue:1_000_000n,requestedAt:1n,status:'Queued',advanceId:0n}],settlement:{cashBalance:0n,repayFirst:0n,queuePayable:0n,queueShortfall:1_000_000n}}],creditLine:{owner,capital:1n,outstanding:0n,totalExposure:0n,earnedFees:0n,lateOutstanding:0n,utilizationBps:0,paused:false,advances:[]}};
}
const deposit:Action={kind:'deposit',platform:DEPLOYMENT.platform,amount:'1.25'};
const exit=():Action=>({kind:'exitNow',platform:DEPLOYMENT.platform,amount:'1',minUsdgOut:990_000n,quotedAt:Date.now()});
const proposal=()=>parseProposal(JSON.stringify({vault:DEPLOYMENT.vaultA,chainId:421614,proposal:{platform:DEPLOYMENT.platform,recipient:owner,requestId:'1',navValue:'1000000',fee:'10000',payout:'990000',feeBps:100,dueAt:'1791047000',expiresAt:'1791046000',nonce:'1',quoteId:digest}}));
function events(){const states:TransactionState[]=[];return {states,onState:(value:TransactionState)=>states.push(value)};}
function proposalReads(overrides:Record<string,unknown>={}) {
 const values:Record<string,unknown>={hashTypedProposal:digest,proposalHashOf:digest,nonceUsed:false,preview:0,owner,mandate:{signer},...overrides};
 mocks.read.mockImplementation(async (_address,_abi,functionName)=>values[functionName]);
}
beforeEach(()=>{
 vi.resetAllMocks();vi.useRealTimers();
 mocks.getChainId.mockResolvedValue(421614);mocks.getBlockNumber.mockResolvedValue(1n);mocks.readContract.mockResolvedValue(0n);
 mocks.simulateContract.mockImplementation(async request=>({request}));mocks.wait.mockResolvedValue({status:'success'});
 mocks.quoteExit.mockResolvedValue({navValue:1_000_000n,fee:10_000n,usdgOut:990_000n,available:true,reason:'',blockNumber:1n,quotedAt:Date.now()});
 mocks.quoteRequest.mockImplementation(()=>mocks.quoteExit());mocks.wallet.mockResolvedValue({writeContract:mocks.write});mocks.write.mockResolvedValue(hash);proposalReads();
});
describe('wallet transaction failure paths',()=>{
 it('refuses RPC on the wrong network before simulation or writes',async()=>{mocks.getChainId.mockResolvedValue(42161);await expect(sendAction(deposit,snapshot())).rejects.toThrow('RPC');expect(mocks.simulateContract).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();});
 it.each(['The selected account is no longer authorized','Switch your wallet to Arbitrum Sepolia'])('does not write when wallet rejects: %s',async message=>{mocks.wallet.mockRejectedValue(new Error(message));const e=events();await expect(sendAction({kind:'pause'},snapshot(),e.onState)).rejects.toThrow(message);expect(mocks.write).not.toHaveBeenCalled();expect(e.states.at(-1)?.phase).toBe('error');});
 it('rejects a freshly changed quote below minimum received',async()=>{mocks.quoteExit.mockResolvedValue({available:true,usdgOut:989_999n});await expect(sendAction(exit(),snapshot())).rejects.toThrow('quote changed');expect(mocks.simulateContract).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();});
 it('does not queue an unavailable exit',async()=>{mocks.quoteRequest.mockResolvedValue({available:false,reason:'window due'});await expect(sendAction({kind:'exitEarly',platform:DEPLOYMENT.platform,requestId:1n,minUsdgOut:990000n,quotedAt:Date.now()},snapshot())).rejects.toThrow('window due');expect(mocks.write).not.toHaveBeenCalled();});
 it('rejects a quote that expires while the network re-quotes',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));const action=exit();mocks.quoteExit.mockImplementation(async()=>{vi.setSystemTime(Date.now()+60001);return {available:true,usdgOut:990000n};});await expect(sendAction(action,snapshot())).rejects.toThrow('Refresh');expect(mocks.write).not.toHaveBeenCalled();vi.useRealTimers();});
 it.each(['simulation','wallet'])('rejects quote expiry during slow %s before broadcast',async delay=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));const action=exit();
  if(delay==='simulation') mocks.simulateContract.mockImplementation(async request=>{vi.setSystemTime(Date.now()+60001);return {request};});
  else mocks.wallet.mockImplementation(async()=>{vi.setSystemTime(Date.now()+60001);return {writeContract:mocks.write};});
  await expect(sendAction(action,snapshot())).rejects.toThrow('Refresh');expect(mocks.write).not.toHaveBeenCalled();vi.useRealTimers();
 });
 it('stops after a reverted USDG approval instead of sending deposit',async()=>{mocks.wait.mockResolvedValue({status:'reverted'});const e=events();await expect(sendAction(deposit,snapshot(),e.onState)).rejects.toThrow('approval reverted');expect(mocks.write).toHaveBeenCalledTimes(1);expect(mocks.simulateContract).toHaveBeenCalledTimes(1);expect(mocks.simulateContract.mock.calls[0][0].functionName).toBe('approve');expect(e.states.map(s=>s.phase)).toEqual(['checking','approval','pending','error']);});
 it('retains the approval hash and blocks automatic retry on unknown receipt',async()=>{mocks.wait.mockRejectedValue(new Error('RPC timeout'));const e=events();await expect(sendAction(deposit,snapshot(),e.onState)).rejects.toThrow('timeout');expect(e.states.at(-1)).toMatchObject({hash,confirmationUnknown:true});expect(mocks.write).toHaveBeenCalledTimes(1);expect(mocks.simulateContract).toHaveBeenCalledTimes(1);});
 it('stops when approval is rejected by the user',async()=>{mocks.write.mockRejectedValue(new Error('User rejected the request'));await expect(sendAction(deposit,snapshot())).rejects.toThrow('User rejected');expect(mocks.wait).not.toHaveBeenCalled();expect(mocks.write).toHaveBeenCalledTimes(1);});
 it('rechecks wallet authorization after approval confirmation',async()=>{mocks.wallet.mockResolvedValueOnce({writeContract:mocks.write}).mockRejectedValueOnce(new Error('Wallet account changed'));await expect(sendAction(deposit,snapshot())).rejects.toThrow('account changed');expect(mocks.write).toHaveBeenCalledTimes(1);expect(mocks.wait).toHaveBeenCalledTimes(1);});
 it('does not write when current contract simulation reverts',async()=>{mocks.simulateContract.mockRejectedValue(new Error('NotIssuer'));await expect(sendAction({kind:'setGated',platform:DEPLOYMENT.platform,gated:true},snapshot())).rejects.toThrow('NotIssuer');expect(mocks.write).not.toHaveBeenCalled();});
 it('reports a reverted action receipt without success',async()=>{mocks.wait.mockResolvedValue({status:'reverted'});const e=events();await expect(sendAction({kind:'pause'},snapshot(),e.onState)).rejects.toThrow('transaction reverted');expect(e.states.map(s=>s.phase)).toEqual(['checking','confirming','pending','error']);expect(e.states.find(s=>s.phase==='pending')?.hash).toBe(hash);expect(e.states.at(-1)).toMatchObject({hash,confirmationUnknown:false});});
 it('reports a failed receipt lookup without claiming success',async()=>{mocks.wait.mockRejectedValue(new Error('Receipt lookup timed out'));const e=events();await expect(sendAction({kind:'pause'},snapshot(),e.onState)).rejects.toThrow('timed out');expect(e.states.at(-1)?.phase).toBe('error');expect(e.states.some(s=>s.phase==='success')).toBe(false);expect(e.states.at(-1)).toMatchObject({hash,confirmationUnknown:true});expect(e.states.at(-1)?.message).toContain('confirmation is unverified');});
 it('approves only the requested amount, then confirms and reports both pending transactions',async()=>{const e=events();await expect(sendAction(deposit,snapshot(),e.onState)).resolves.toBe(hash);expect(mocks.simulateContract.mock.calls[0][0].args).toEqual([DEPLOYMENT.platform,1_250_000n]);expect(mocks.simulateContract.mock.calls[1][0].functionName).toBe('deposit');expect(mocks.wallet).toHaveBeenCalledTimes(2);expect(e.states.map(s=>s.phase)).toEqual(['checking','approval','pending','confirming','pending','success']);});
 it('skips redundant approvals when allowance already covers the exact amount',async()=>{mocks.readContract.mockResolvedValue(1_250_000n);const e=events();await sendAction(deposit,snapshot(),e.onState);expect(mocks.write).toHaveBeenCalledTimes(1);expect(mocks.simulateContract.mock.calls[0][0].functionName).toBe('deposit');expect(e.states.some(s=>s.phase==='approval')).toBe(false);});
});
describe('partner proposal funding authority',()=>{
 it('will not approve a changed digest even if the mandate preview passes',async()=>{proposalReads({proposalHashOf:hash});await expect(approveProposal(proposal(),owner)).rejects.toThrow('not filed');expect(mocks.wallet).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();});
 it('rejects a used nonce before any wallet prompt',async()=>{proposalReads({nonceUsed:true});await expect(approveProposal(proposal(),owner)).rejects.toThrow('already been used');expect(mocks.simulateContract).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();});
 it('honors the live mandate rejection',async()=>{proposalReads({preview:10});await expect(approveProposal(proposal(),owner)).rejects.toThrow('Insufficient reserve');expect(mocks.write).not.toHaveBeenCalled();});
 it('blocks an outsider despite a ready filed proposal',async()=>{await expect(approveProposal(proposal(),outsider)).rejects.toThrow('owner or partner signer');expect(mocks.wallet).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();});
 it('requires wallet authorization before simulating or writing approval',async()=>{mocks.wallet.mockRejectedValue(new Error('Wrong wallet network'));await expect(approveProposal(proposal(),owner)).rejects.toThrow('Wrong wallet');expect(mocks.simulateContract).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();});
 it('does not fund when the nonce is consumed between review and simulation',async()=>{mocks.simulateContract.mockRejectedValue(new Error('NonceUsed'));await expect(approveProposal(proposal(),owner)).rejects.toThrow('NonceUsed');expect(mocks.write).not.toHaveBeenCalled();});
 it('rechecks proposal wallet after simulation and refuses a changed account',async()=>{mocks.wallet.mockResolvedValueOnce({writeContract:mocks.write}).mockRejectedValueOnce(new Error('Wallet account changed'));await expect(approveProposal(proposal(),owner)).rejects.toThrow('account changed');expect(mocks.write).not.toHaveBeenCalled();});
 it('retains partner funding hash if confirmation cannot be obtained',async()=>{mocks.wait.mockRejectedValue(new Error('RPC timeout'));const e=events();await expect(approveProposal(proposal(),owner,e.onState)).rejects.toThrow('timeout');expect(e.states.at(-1)).toMatchObject({hash,confirmationUnknown:true});expect(e.states.at(-1)?.message).toContain('confirmation is unverified');});
 it('allows the actual mandate signer and emits receipt-backed success',async()=>{const e=events();await expect(approveProposal(proposal(),signer,e.onState)).resolves.toBe(hash);expect(mocks.simulateContract.mock.calls[0][0].functionName).toBe('approve');expect(mocks.simulateContract.mock.calls[0][0].args[0]).toEqual(proposal().proposal);expect(e.states.map(s=>s.phase)).toEqual(['checking','confirming','pending','success']);});
 it('handles reverted partner approval receipts as failure',async()=>{mocks.wait.mockResolvedValue({status:'reverted'});const e=events();await expect(approveProposal(proposal(),owner,e.onState)).rejects.toThrow('approval reverted');expect(e.states.at(-1)?.phase).toBe('error');expect(e.states.at(-1)).toMatchObject({hash,confirmationUnknown:false});expect(e.states.some(s=>s.phase==='success')).toBe(false);});
 it('refuses verification on any other chain',async()=>{mocks.getChainId.mockResolvedValue(1);await expect(verifyProposal(proposal())).rejects.toThrow('Arbitrum Sepolia');expect(mocks.read).not.toHaveBeenCalled();});
});
