import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

export const evidenceDir=resolve(`../docs/proof/demo/run-${Date.now()}`);
const json=(value:unknown)=>JSON.stringify(value,(_,part)=>typeof part==='bigint'?String(part):part,2);
export async function prepareProof(){await mkdir(evidenceDir,{recursive:true});}
export async function saveProof(name:string,value:unknown){await writeFile(resolve(evidenceDir,name),json(value)+'\n');}
export async function hashFile(path:string){return createHash('sha256').update(await readFile(path)).digest('hex');}
export async function until<T>(read:()=>Promise<T>,matches:(value:T)=>boolean){let value=await read();await expect.poll(async()=>{value=await read();return matches(value);}).toBe(true);return value;}
export async function copyVideo(source:string,persona:string){const dest=resolve(evidenceDir,`${persona}.webm`);await rename(source,dest);return {file:`${persona}.webm`,sha256:await hashFile(dest)};}
export async function captureWidths(page:Page,persona:string,stage:string){
 const result:{width:number;file:string;sha256:string;scrollWidth:number;viewportWidth:number}[]=[];
 for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  const file=`${persona}-${stage}-${width}.png`,path=resolve(evidenceDir,file);
  await page.screenshot({path,fullPage:true,animations:'disabled'});
  const sizes=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewportWidth:window.innerWidth}));
  expect(sizes.scrollWidth,`${persona} ${stage} ${width}px horizontal overflow`).toBeLessThanOrEqual(sizes.viewportWidth+1);
  result.push({width,file,sha256:await hashFile(path),...sizes});
 }
 await page.setViewportSize({width:1440,height:900});
 return result;
}
