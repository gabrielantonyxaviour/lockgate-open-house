import { expect, type Browser, type Page } from '@playwright/test';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { signedSource } from './signed-source';
import { startSignedFork, type Persona } from './signed-fork';
export async function signedProof(browser:Browser, label:string) {
  const artifactDir=resolve('../docs/proof/wallet/'+label+'-'+Date.now());
  await mkdir(artifactDir,{recursive:true});
  const fork=await startSignedFork();const source=await signedSource();
  const pages:{persona:Persona;page:Page}[]=[];
  const runtimeErrors:string[]=[],consoleErrors:string[]=[],cleanupErrors:string[]=[];
  const json=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
  const refresh=async(page:Page)=>{
    await expect(page.getByRole('button',{name:'Refresh chain data'})).toBeEnabled({timeout:45000});
    await page.getByRole('button',{name:'Refresh chain data'}).click();
    await expect(page.getByRole('button',{name:'Refresh chain data'})).toBeEnabled({timeout:45000});
  };
  const open=async(persona:Persona,route:string)=>{
    const context=await browser.newContext({baseURL:'http://127.0.0.1:5197',viewport:{width:1440,height:1000},recordVideo:{dir:artifactDir,size:{width:1440,height:1000}}});
    context.setDefaultTimeout(30000);
    const page=await context.newPage();pages.push({persona,page});
    page.on('pageerror',e=>runtimeErrors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await fork.inject(page,persona);
    await page.clock.setSystemTime(Number((await fork.client.getBlock()).timestamp)*1000);
    await page.goto(route);await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();
    await expect(page.getByRole('button',{name:'Refresh chain data'})).toBeEnabled({timeout:45000});
    return page;
  };
  const confirm=async(page:Page)=>{
    await page.getByRole('dialog').getByRole('button',{name:'Confirm in wallet'}).click();
    await expect(page.getByRole('heading',{name:'Transaction confirmed',exact:true})).toBeVisible({timeout:30000});
    await page.getByRole('button',{name:'Done',exact:true}).click();
  };
  const fund=async(page:Page,title:string,amount:string)=>{
    const section=page.locator('.funding-form').filter({has:page.getByRole('textbox',{name:title+' amount',exact:true})});
    await section.getByRole('textbox').fill(amount);await section.getByRole('button',{name:'Review',exact:true}).click();await confirm(page);
  };
  const capture=async(page:Page,name:string)=>{
    const target=await fork.client.getBlockNumber({cacheTime:0});
    await expect.poll(async()=>{await refresh(page);const text=await page.locator('.data-status').innerText();return BigInt(text.match(/Read at block (\d+)/)?.[1]??'0')>=target;},{timeout:60000}).toBe(true);
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:resolve(artifactDir,name+'-'+width+'.png'),animations:'disabled',fullPage:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    }
  };
  const finish=async(completed:boolean,checks:unknown)=>{
    fork.beginClose();
    const failures:unknown[]=[];
    if(!completed)for(const{persona,page}of pages){
      failures.push({persona,url:page.url(),text:await page.locator('body').innerText().catch(()=> '')});
      await page.screenshot({path:resolve(artifactDir,persona+'-failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});
    }
    for(const{persona,page}of pages){
      try{await page.context().close();const path=await page.video()?.path();if(path)await rename(path,resolve(artifactDir,persona+'.webm'));}catch(e){cleanupErrors.push(String(e));}
    }
    await fork.close().catch(e=>cleanupErrors.push(String(e)));
    const artifacts=await Promise.all((await readdir(artifactDir)).filter(f=>/\.(webm|png)$/.test(f)).map(async file=>({file,sha256:createHash('sha256').update(await readFile(resolve(artifactDir,file))).digest('hex')})));
    await writeFile(resolve(artifactDir,'manifest.json'),json({completed,source,scope:'LOCAL FORK ONLY: genuine locally signed raw transactions; no public network writes or extension-wallet verification',timestamp:new Date().toISOString(),receipts:fork.receipts,signatures:fork.signatures,fixtures:fork.fixtures,checks,runtimeErrors,consoleErrors,cleanupErrors,failures,artifacts}));
  };
  return{fork,open,refresh,confirm,fund,capture,finish,runtimeErrors,consoleErrors};
}
