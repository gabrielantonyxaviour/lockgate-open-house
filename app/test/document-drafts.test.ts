import { afterEach, expect, it, vi } from 'vitest';
import { keccak256, stringToHex, type Address } from 'viem';
import { createDemoGateway } from '../src/services/demo-gateway';
import { DemoTransport } from '../src/services/demo-transport';

const wallet='0x1111111111111111111111111111111111111111' as Address;
const other='0x2222222222222222222222222222222222222222' as Address;
const digest=(text:string)=>keccak256(stringToHex(text));
const gateway=()=>{const g=createDemoGateway();Object.assign(g,{account:wallet,state:{profile:{identity:{name:'Priya Menon'}},vehicles:[]}});return g;};
const offer=(investor=wallet,text='Exact TEST exit letter')=>({id:'offer-1',vehicleId:'firm-1',firm:'Northstar',vehicle:'Northstar vehicle',route:'purchase',amount:'1',payout:'0.98',fee:'0.02',residual:'0',expiresAt:new Date(Date.now()+600_000).toISOString(),agreement:{id:'EXIT-LETTER-abcdef123456',version:'2',title:'TEST exit',text,digest:digest('Exact TEST exit letter'),signed:false,accepted:false},quote:{holdingId:digest('holding'),vault:other,investor,identity:digest('identity'),units:'1000000',payout:'980000',repayment:'1000000',route:1,deadline:String(Math.floor(Date.now()/1000)+600),maturity:String(Math.floor(Date.now()/1000)+3600),nonce:'1',agreementHash:digest('Exact TEST exit letter')}});

afterEach(()=>vi.restoreAllMocks());

it('saved draft rejects a changed digest before reporting success',async()=>{
 vi.spyOn(DemoTransport.prototype,'request').mockResolvedValue({id:'EXIT-LETTER-abcdef123456',kind:'exit',title:'TEST exit',text:'Altered',digest:digest('Original'),version:'2',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString(),vehicleId:'firm-1',amount:'1'});
 await expect(gateway().saveDocumentDraft('exit','EXIT-LETTER-abcdef123456')).rejects.toThrow('does not match');
});

it('resume stores a valid quote for signing and rejects another wallet or altered letter',async()=>{
 const spy=vi.spyOn(DemoTransport.prototype,'request').mockResolvedValue({kind:'exit',offer:offer()});
 await expect(gateway().resumeDocumentDraft('EXIT-LETTER-abcdef123456')).resolves.toMatchObject({kind:'exit',offer:{id:'offer-1'}});
 spy.mockResolvedValueOnce({kind:'exit',offer:offer(other)});
 await expect(gateway().resumeDocumentDraft('EXIT-LETTER-abcdef123456')).rejects.toThrow('does not match');
 spy.mockResolvedValueOnce({kind:'exit',offer:offer(wallet,'Altered')});
 await expect(gateway().resumeDocumentDraft('EXIT-LETTER-abcdef123456')).rejects.toThrow('does not match');
});
