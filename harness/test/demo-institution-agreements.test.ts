import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import type { Manifest } from '../src/demo/shared.js';
import type { OfferRecord, ProfileRecord, SubscriptionAgreement } from '../src/demo/store.js';
import { institutionScope } from '../src/demo/institution-representatives.js';
import { selectInstitutionAgreements } from '../src/demo/institution-agreements.js';

const addr=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as Address;
const hex=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as Hex;
const alder='0xdf4cf26bd1be352505b2d76de2f4f19c0a020b06' as Address;
const meridian='0xbd01f07b5a7be85b2fd961c7fd3f99d1db7edfbd' as Address;
const manifest:Manifest={chainId:421614,rpcUrl:'http://127.0.0.1:8545',asset:addr(60),registry:addr(61),settlement:addr(62),holdings:[],
 originators:['Alder Credit Platform','Birch Receivables','Cedar Income Trust','Dune Asset Network','Elm Yield Platform'].map((name,index)=>({name,address:addr(index+1)})),
 vaults:['Northstar Investment Firm','Meridian Investment Firm','Anchor Capital Firm','Bluewater Investment Firm','Pioneer Securities Firm'].map((firm,index)=>({id:`firm-${index+1}`,name:`${firm} vehicle`,firm,address:addr(index+30),manager:addr(index+20),termsHash:hex(index+1),termsText:'TEST terms'}))};
const empty=():ProfileRecord=>({agreements:{},receipts:[],offers:[],minted:[]});
const offer=(account:Address,id:string,holdingId:Hex,vehicleId:string,vault:Address):OfferRecord=>({
 id,account,vehicleId,holdingId,quote:{holdingId,vault},residualUnits:'0',originatorSignature:hex(80),investorSignature:hex(81),
 signedAt:'2026-10-04T12:00:00.000Z',createdAt:'2026-10-04T11:55:00.000Z',
 agreement:{id,version:'2',title:`Original ${id}`,text:`Exact legal text for ${id}.`,digest:hex(Number(id.at(-1))),signed:true,accepted:true,signerName:'Lucas Chen'}
});
const subscription=(id:string,digest:Hex):SubscriptionAgreement=>({documentId:id,version:'2',digest,amount:'1000',message:`Exact signed subscription ${id}.`,
 signature:hex(90),signedAt:'2026-10-04T13:00:00.000Z',subscriptionId:id==='letter-funded'?'2':'1',txHash:hex(91),signerName:'Priya Menon'});

test('Manager sees only signed letters for its vault, including accepted but unfunded subscriptions',async()=>{
 const lucas=addr(100),priya=addr(101),other=addr(102),a=empty(),b=empty(),c=empty();
 a.offers.push(offer(lucas,'exit-1',hex(401),'firm-2',manifest.vaults[1].address));
 a.offers.push(offer(lucas,'exit-2',hex(402),'firm-1',manifest.vaults[0].address));
 a.offers.push({...offer(lucas,'exit-3',hex(403),'firm-2',manifest.vaults[1].address),investorSignature:undefined});
 b.agreements['firm-2']=subscription('letter-accepted',hex(501));
 b.agreementHistory=[{vehicleId:'firm-2',agreement:b.agreements['firm-2']}];
 c.agreements['firm-1']=subscription('letter-funded',hex(502));
 const scope=institutionScope(meridian,manifest)!;
 const result=await selectInstitutionAgreements(scope,manifest,[{account:lucas,profile:a},{account:priya,profile:b},{account:other,profile:c}],{
  holdingOriginator:async()=>{throw Error('Manager selection should not need holding reads');},
  subscription:async(vault,id)=>({provider:vault===manifest.vaults[1].address&&id==='1'?priya:other,funded:false})
 });
 assert.deepEqual(result.map(item=>item.id),['letter-accepted','exit-1']);
 assert.equal(result[0].text,'Exact signed subscription letter-accepted.');
 assert.equal(result[0].digest,hex(501));
 assert.equal(result[0].status,'Firm accepted TEST subscription');
 assert.equal(result[0].signerName,'Priya Menon');
 assert.equal(result[1].text,'Exact legal text for exit-1.');
});

test('Funding status follows the actual accepted subscription; wrong provider cannot leak a letter',async()=>{
 const investor=addr(103),p=empty();
 p.agreements['firm-2']=subscription('letter-funded',hex(503));
 const scope=institutionScope(meridian,manifest)!;
 const selected=()=>selectInstitutionAgreements(scope,manifest,[{account:investor,profile:p}],{
  holdingOriginator:async()=>addr(1),subscription:async()=>({provider:investor,funded:true})
 });
 assert.equal((await selected())[0].status,'Funded TEST subscription');
 assert.deepEqual(await selectInstitutionAgreements(scope,manifest,[{account:investor,profile:p}],{
  holdingOriginator:async()=>addr(1),subscription:async()=>({provider:addr(104),funded:true})
 }),[]);
});

test('Originator sees only exits against its actual holding originator, across firms, and no provider letters',async()=>{
 const investor=addr(105),p=empty();
 p.offers.push(offer(investor,'exit-4',hex(404),'firm-2',manifest.vaults[1].address));
 p.offers.push(offer(investor,'exit-5',hex(405),'firm-1',manifest.vaults[0].address));
 p.agreements['firm-2']=subscription('letter-accepted',hex(506));
 const scope=institutionScope(alder,manifest)!;
 const selected=await selectInstitutionAgreements(scope,manifest,[{account:investor,profile:p}],{
  holdingOriginator:async id=>id===hex(404)?manifest.originators[0].address:manifest.originators[1].address,
  subscription:async()=>{throw Error('Originator must not read provider subscriptions');}
 });
 assert.deepEqual(selected.map(item=>item.id),['exit-4']);
 assert.equal(institutionScope(addr(900),manifest),undefined,'unlisted wallet gets no institution scope');
});
