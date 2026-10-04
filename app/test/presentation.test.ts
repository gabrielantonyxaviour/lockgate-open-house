import { expect, it } from 'vitest';
import { presentationState } from '../src/demo/presentation';
import type { DemoState } from '../src/demo/types';

it('cleans labels without changing signed bytes, identity references or reviewed action inputs',()=>{
 const text='Original TEST agreement; TEST-IDENTITY-001';
 const state:DemoState={profile:{roles:['manager'],identity:{id:'lucas',name:'Lucas Chen',jurisdiction:'Singapore',identityRef:'TEST-IDENTITY-001',fixtureCase:'match'}},positions:[],positionStatus:'empty',vehicles:[],receipts:[],setup:{gas:'1',usdg:'500000',canMint:false,canFund:false},deploymentReady:true,
  institutionAgreements:[{id:'signed-1',title:'TEST subscription',text,digest:`0x${'1'.repeat(64)}`,version:'2',status:'Funded TEST subscription'}],
  workspace:{title:'Firm',organization:'Meridian',status:'Active TEST firm',checks:[],records:[{id:'cash',label:'Available cash',value:'500000 test USDG'}],actions:[{id:'mandate',label:'Set mandate',description:'Per-deal test USDG',kind:'mandate',fields:[{key:'identity',label:'TEST profile',value:'TEST-IDENTITY-001',type:'text',required:true}]}]}};
 const view=presentationState(state);
 expect(view.institutionAgreements?.[0].title).toBe('subscription');
 expect(view.institutionAgreements?.[0].text).toBe(text);
 expect(view.institutionAgreements?.[0].digest).toBe(state.institutionAgreements?.[0].digest);
 expect(view.profile.identity?.identityRef).toBe('TEST-IDENTITY-001');
 expect(view.workspace?.records[0].value).toBe('500000 USDG');
 expect(view.workspace?.actions?.[0].fields[0].value).toBe('TEST-IDENTITY-001');
 expect(state.workspace?.status).toBe('Active TEST firm');
});
