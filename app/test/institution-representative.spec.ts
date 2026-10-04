import { expect, test, type Page } from '@playwright/test';
// Presentation fixtures only: these tests do not sign or submit blockchain transactions.
const wallet='0xdf4cf26bd1be352505b2d76de2f4f19c0a020b06';
const executor='0x82130f97959Bb7410c6Fff67c3df43ca8499179D';
const hash=`0x${'a'.repeat(64)}`;
const action={id:'originator.repay',label:'Repay an exit obligation',description:'Approve exact test USDG and repay the selected on-chain deal.',kind:'repay',fields:[{key:'digest',label:'Exit obligation',type:'text',required:true,value:hash,options:[{value:hash,label:'19,686 TEST USDG due · Alder Private Credit'}]}]};
const mandate={id:'manager.set-mandate',label:'Set risk mandate',description:'Set originator risk limits.',kind:'mandate',fields:[{key:'originatorAddress',label:'Originator',type:'text',required:true,value:executor,options:[{value:executor,label:'Alder Credit Platform'}]},{key:'exposurePercent',label:'Maximum exposure (% of NAV)',type:'amount',required:true,value:'20'},{key:'dealLimit',label:'Per-deal limit (test USDG)',type:'amount',required:true,value:'100000'},{key:'routeMask',label:'Permitted routes',type:'text',required:true,value:'3'}]};
async function fixture(page:Page,role:'originator'|'manager'='originator',failure=false,pending=false){
 await page.addInitScript(address=>{
  localStorage.setItem('lockgate.wallet.connected.v1','1');
  Object.assign(window,{ethereum:{request:async({method}:{method:string})=>method==='eth_chainId'?'0x66eee':[address],on(){},removeListener(){}}});
 },wallet);
 const workspace={title:role==='manager'?'Investment firm workspace':'Originator workspace',organization:role==='manager'?'Meridian Investment Firm':'Alder Credit Platform',status:'Active TEST organization',authorization:{representativeWallet:wallet,executionWallet:executor,role},checks:[{label:'Approved representative',status:'Active'}],records:role==='manager'?[{id:'nav',label:'Net asset value',value:'500000 test USDG'},{id:'cash',label:'Available cash',value:'480314 test USDG'},{id:'principal',label:'Outstanding principal',value:'19686 test USDG'},{id:'vault',label:'Vehicle',value:executor},{id:'mandate-alder',label:'Alder Credit Platform',value:'20% of current NAV · 100000 TEST USDG per deal · Finance · 19686 TEST USDG used'}]:[{id:'holding',label:'Alder Private Credit',value:'80000 TEST units remaining'},{id:'debt',label:'Exit obligation',value:'19686 TEST USDG due · Finance · Alder Private Credit'}],actions:[role==='manager'?mandate:action],pendingActions:pending?[{id:'pending-plan',actionId:action.id,inputs:{digest:hash},authorized:true}]:[]};
 const state={profile:{roles:[role],activeRole:role},workspace,positions:[],positionStatus:'empty',vehicles:[],receipts:[{id:'old',title:'Prior registration',status:'confirmed',hash,createdAt:new Date().toISOString(),account:wallet}],setup:{gas:'0.001',usdg:'10000',canMint:false,canFund:false},deploymentReady:true};
 await page.route('**/src/services/demo-gateway.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const state=${JSON.stringify(state)};let attempts=0;export function createDemoGateway(){return{publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0'}),authenticate:async()=>state,refresh:async()=>state,workspaceAction:async(id,fields,progress)=>{attempts++;const emit=(phase,extra={})=>progress?.({phase,executionAccount:'${executor}',totalSteps:2,...extra});emit('preparing');emit('authorization-requested');await new Promise(r=>setTimeout(r,100));emit('authorized');emit('submitted',{stepIndex:0,label:'${role==='manager'?'Set mandate':'Approve USDG'}',hash:'${hash}'});emit('confirmed',{stepIndex:0,label:'${role==='manager'?'Set mandate':'Approve USDG'}',hash:'${hash}'});if(${failure}&&attempts===1){emit('error',{message:'Repayment could not complete.'});throw Error('Repayment could not complete.');}emit('submitted',{stepIndex:1,label:'${role==='manager'?'Set exposure cap':'Repay obligation'}',hash:'${hash}'});await new Promise(r=>setTimeout(r,100));emit('confirmed',{stepIndex:1,label:'${role==='manager'?'Set exposure cap':'Repay obligation'}',hash:'${hash}'});const receipt={id:'new',title:'Repay financed exit',status:'confirmed',hash:'${hash}',createdAt:new Date().toISOString(),account:'${wallet}'};state.receipts.unshift(receipt);return receipt;}}}` }));
 await page.goto('/');await page.getByRole('button',{name:'Connect Wallet'}).click();await expect(page.getByRole('heading',{name:workspace.title})).toBeVisible();
}
for(const width of [375,768,1440])for(const role of ['originator','manager'] as const)test(`${role} institution review is clear at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await fixture(page,role);
 await expect(page.getByText('Authorized team representative')).toBeVisible();
 await expect(page.getByText('Prior registration',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(process.env.LOCKGATE_VISUAL_REVIEW==='1')await page.screenshot({path:`/tmp/lockgate-institution-${role}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:role==='manager'?'Set risk mandate':'Repay an exit obligation',exact:true}).click();
 await page.getByRole('button',{name:'Review action',exact:true}).click();
 await expect(page.getByText(role==='manager'?'Both permitted routes':'19,686 TEST USDG due · Alder Private Credit',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Authorize action',exact:true})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Action progress'})).toContainText('Your wallet signs once. 2 transactions');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(process.env.LOCKGATE_VISUAL_REVIEW==='1')await page.screenshot({path:`/tmp/lockgate-institution-review-${role}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Authorize action',exact:true}).click();
 await expect(page.getByText('Action confirmed',{exact:true})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Action progress'}).getByText('Confirmed',{exact:true})).toHaveCount(2);
 await page.getByRole('button',{name:'View transactions',exact:true}).click();
 await expect(page.getByText('Prior registration',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Readiness & authority'})).toHaveCount(0);
});
test('a failed second chain step retains the first proof and retries the same action',async({page})=>{
 await fixture(page,'originator',true);await page.getByRole('button',{name:'Repay an exit obligation',exact:true}).click();await page.getByRole('button',{name:'Review action'}).click();await page.getByRole('button',{name:'Authorize action',exact:true}).click();
 await expect(page.getByText('Action needs attention',{exact:true})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Action progress'}).getByText('Confirmed',{exact:true})).toHaveCount(1);
 await expect(page.getByText('19,686 TEST USDG due · Alder Private Credit',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Retry same action'}).click();await expect(page.getByText('Action confirmed',{exact:true})).toBeVisible();
});
test('an existing pending plan resumes with its reviewed inputs',async({page})=>{
 await fixture(page,'originator',false,true);await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Resume action'}).click();
 await expect(page.getByRole('heading',{name:'Review this action.'})).toBeVisible();await expect(page.getByText('19,686 TEST USDG due · Alder Private Credit',{exact:true})).toBeVisible();await expect(page.getByText('Authorization confirmed',{exact:true})).toBeVisible();
});
