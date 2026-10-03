import { describe,expect,it } from 'vitest';
import {parseProposal} from '../src/chain/proposals';
import {DEPLOYMENT} from '../src/chain/config';
const proposal={platform:DEPLOYMENT.platform,recipient:'0x1111111111111111111111111111111111111111',requestId:'0',navValue:'1000000',fee:'10000',payout:'990000',feeBps:100,dueAt:'1791047000',expiresAt:'1791046000',nonce:'0',quoteId:`0x${'11'.repeat(32)}`};
const raw=()=>({vault:DEPLOYMENT.vaultA,chainId:421614,proposal:{...proposal}});
describe('signed proposal import boundaries',()=>{
 it('parses exact base units, zero nonce and full typed message',()=>{const parsed=parseProposal(JSON.stringify(raw()));expect(parsed.proposal.navValue).toBe(1000000n);expect(parsed.proposal.nonce).toBe(0n);});
 it('accepts engine filing shape and binds domain',()=>{expect(parseProposal(JSON.stringify({message:proposal,domain:{name:'LockgateAdvance',version:'1',chainId:421614,verifyingContract:DEPLOYMENT.vaultB}})).vault).toBe(DEPLOYMENT.vaultB);});
 it('refuses mainnet and arbitrary verifying contracts',()=>{expect(()=>parseProposal(JSON.stringify({...raw(),chainId:42161}))).toThrow();expect(()=>parseProposal(JSON.stringify({...raw(),vault:proposal.recipient}))).toThrow();});
 it('refuses rounded numeric money or missing terms',()=>{expect(()=>parseProposal(JSON.stringify({...raw(),proposal:{...proposal,navValue:1000000}}))).toThrow();expect(()=>parseProposal(JSON.stringify({...raw(),proposal:{navValue:'1'}}))).toThrow();});
 it('refuses inconsistent payout and fee',()=>expect(()=>parseProposal(JSON.stringify({...raw(),proposal:{...proposal,payout:'980000'}}))).toThrow());
 it('refuses negative nonce, overflowing timestamp, and malformed quoteId',()=>{for(const patch of [{nonce:'-1'},{dueAt:(1n<<64n).toString()},{quoteId:'0x123'}]) expect(()=>parseProposal(JSON.stringify({...raw(),proposal:{...proposal,...patch}}))).toThrow();});
 it('refuses fee bps outside contractual range and zero recipients',()=>{expect(()=>parseProposal(JSON.stringify({...raw(),proposal:{...proposal,feeBps:10001}}))).toThrow();expect(()=>parseProposal(JSON.stringify({...raw(),proposal:{...proposal,recipient:'0x0000000000000000000000000000000000000000'}}))).toThrow();});
});
