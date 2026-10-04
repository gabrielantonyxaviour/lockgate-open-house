import { expect, test, type Page } from '@playwright/test';
// UI regression fixtures only; no wallet signatures or chain transactions.
const hash=`0x${'b'.repeat(64)}`;
async function fixture(page:Page,refreshFailure=false,twoPositions=false){
 await page.addInitScript(()=>{localStorage.setItem('lockgate.wallet.connected.v1','1');Object.assign(window,{ethereum:{request:async({method}:{method:string})=>method==='eth_chainId'?'0x66eee':['0x1111111111111111111111111111111111111111'],on:()=>{},removeListener:()=>{}}});});
 await page.route('**/src/services/demo-gateway.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
 const original={id:'cedar',name:'Cedar Income Fund',originator:'Cedar Income Trust',instrument:'Fund interest',available:'1000',faceValue:'1000',partial:true};
 const minted={id:'alder',name:'Alder Private Credit',originator:'Alder Credit Platform',instrument:'Private credit claim',available:'100000',faceValue:'100000',partial:true};
 const receipt={id:'mint',title:'Test position minted',status:'confirmed',hash:'${hash}',createdAt:'2026-10-04T12:00:00Z',account:'0x1111111111111111111111111111111111111111'};
 const state={profile:{roles:['investor'],activeRole:'investor',identity:{id:'alex-morgan',name:'Alex Morgan',jurisdiction:'Singapore',fixtureCase:'match'}},positions:[original${twoPositions?',minted':''}],positionStatus:'matched',vehicles:[],receipts:[],setup:{gas:'0.0005',usdg:'0',canMint:true,canFund:false,mintDescription:'100,000 TEST units in Alder Private Credit, recorded to your bound identity.'},deploymentReady:true};
 let done=false,failed=false;window.mintCalls=0;window.refreshCalls=0;
 export function createDemoGateway(){return {
 publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0',environment:'UI FIXTURE'}),authenticate:async()=>structuredClone(state),
 mintPosition:()=>{window.mintCalls++;return new Promise((resolve,reject)=>{window.resolveMint=()=>{done=true;resolve(receipt)};window.rejectMint=()=>reject(new Error('Mint request could not be confirmed. Check setup before retrying.'));})},
 refresh:async()=>{window.refreshCalls++;if(${refreshFailure}&&!failed){failed=true;throw new Error('Refresh temporarily unavailable');}if(done){state.positions=[original,minted];state.receipts=[receipt];state.setup.canMint=false;}return structuredClone(state);}
 }};` }));
 await page.goto('/');await page.getByRole('button',{name:'Connect Wallet'}).click();
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
}
test('mint has one busy button, receipt confirmation and automatic dashboard refresh',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Demo',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Demo setup'});await sheet.getByRole('button',{name:'Mint test position',exact:true}).click();
 const mint=sheet.getByRole('button',{name:'Minting test position…'});await expect(mint).toBeDisabled();await expect(mint.locator('.dg-spin')).toHaveCount(1);
 const check=sheet.getByRole('button',{name:'Check setup',exact:true});await expect(check).toBeDisabled();await expect(check.locator('.dg-spin')).toHaveCount(0);
 await expect(sheet.getByRole('status')).toContainText('Waiting for confirmation on Arbitrum Sepolia');
 await page.evaluate(()=>Reflect.get(window,'resolveMint')());
 await expect(sheet.getByRole('status')).toContainText('Test position minted');
 await expect(sheet.getByRole('link',{name:'View transaction in explorer'})).toHaveAttribute('href',`https://sepolia.arbiscan.io/tx/${hash}`);
 await expect(sheet.getByRole('button',{name:'Position minted',exact:true})).toBeDisabled();
 await expect(check).toBeEnabled();
 await sheet.getByRole('button',{name:'Close Demo'}).click();
 await expect(page.getByRole('heading',{name:'Alder Private Credit',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Reflect.get(window,'mintCalls'))).toBe(1);
 expect(await page.evaluate(()=>Reflect.get(window,'refreshCalls'))).toBe(1);
});
test('confirmed mint survives a failed refresh and retries only account discovery',async({page})=>{
 await fixture(page,true);await page.getByRole('button',{name:'Demo',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Demo setup'});await sheet.getByRole('button',{name:'Mint test position',exact:true}).click();await page.evaluate(()=>Reflect.get(window,'resolveMint')());
 await expect(sheet.getByRole('status')).toContainText('transaction is confirmed, but your account could not refresh');
 await expect(sheet.getByRole('button',{name:'Position minted',exact:true})).toBeDisabled();
 await expect(page.locator('.dg-body').getByRole('alert')).toHaveCount(0);
 await sheet.getByRole('button',{name:'Check setup',exact:true}).click();await expect(sheet.getByRole('status')).toContainText('Setup is up to date');
 await sheet.getByRole('button',{name:'Close Demo'}).click();await expect(page.getByRole('heading',{name:'Alder Private Credit',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Reflect.get(window,'mintCalls'))).toBe(1);
});
test('mint failure is readable inside the sheet',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Demo',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Demo setup'});await sheet.getByRole('button',{name:'Mint test position',exact:true}).click();await page.evaluate(()=>Reflect.get(window,'rejectMint')());
 await expect(sheet.getByRole('alert')).toContainText('Mint request could not be confirmed');
 await expect(sheet.getByRole('button',{name:'Check setup',exact:true})).toBeEnabled();
});
for(const width of [375,768,1440])test(`position cards align consistently at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});await fixture(page,false,true);
 const cards=page.locator('.dg-dashboard-holdings>.dg-panel');await expect(cards).toHaveCount(2);
 const boxes=await cards.evaluateAll(items=>items.map(item=>{const box=item.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height,marginTop:getComputedStyle(item).marginTop,buttonY:item.querySelector('button')!.getBoundingClientRect().bottom-box.bottom};}));
 expect(boxes[0].marginTop).toBe('0px');expect(boxes[1].marginTop).toBe('0px');expect(Math.abs(boxes[0].height-boxes[1].height)).toBeLessThanOrEqual(1);expect(Math.abs(boxes[0].width-boxes[1].width)).toBeLessThanOrEqual(1);expect(Math.abs(boxes[0].buttonY-boxes[1].buttonY)).toBeLessThanOrEqual(1);
 if(width===1440)expect(boxes[0].y).toBe(boxes[1].y);else expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
