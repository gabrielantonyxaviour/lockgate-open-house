import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
 await page.route('**/src/services/demo-gateway.ts*', route => route.fulfill({contentType:'application/javascript',body:`export function createDemoGateway(){return {publicOverview:async()=>({originators:5,firms:5,availableCash:'100',outstanding:'0',environment:'UI FIXTURE'})}}`}));
 await page.goto('/');
});

test('contact exposes working email destination, copies address and supports keyboard dismissal',async({page})=>{
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{Reflect.set(window,'copiedSupportEmail',value);}}}));
 const trigger=page.getByRole('button',{name:'Contact',exact:true});
 await trigger.click();
 const panel=page.getByRole('dialog',{name:'Contact Lockgate'});
 await expect(panel.getByRole('link',{name:'Email us'})).toHaveAttribute('href','mailto:gabriel@lockgate.finance');
 await expect(panel.getByRole('link',{name:'Email us'})).toBeFocused();
 await panel.getByRole('button',{name:'Copy email'}).click();
 await expect(panel.getByRole('status')).toHaveText('Email address copied.');
 expect(await page.evaluate(()=>Reflect.get(window,'copiedSupportEmail'))).toBe('gabriel@lockgate.finance');
 await page.keyboard.press('Escape');
 await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
});

test('clipboard failure offers selectable address and outside click closes contact',async({page})=>{
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Permission denied');}}}));
 await page.getByRole('button',{name:'Contact',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Contact Lockgate'});
 await panel.getByRole('button',{name:'Copy email'}).click();
 await expect(panel.getByRole('alert')).toContainText('Select the email address above');
 await expect(panel.locator('.dg-footer-email')).toHaveText('gabriel@lockgate.finance');
 await page.getByRole('heading',{name:'An earlier exit, on your terms.'}).click();
 await expect(panel).toHaveCount(0);
});

for(const width of [375,768,1440])test(`footer and contact fit ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const footer=page.locator('.dg-app-footer');await footer.scrollIntoViewIfNeeded();
 await page.getByRole('button',{name:'Contact',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Contact Lockgate'});await expect(panel).toBeVisible();
 const box=await panel.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);expect(box!.y).toBeGreaterThanOrEqual(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
