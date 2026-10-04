import { build } from '../harness/node_modules/esbuild/lib/main.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'..');
await mkdir(resolve(directory,'build'),{recursive:true});
const files={};
for(const name of ['sepolia-manifest.json','sepolia-fixture.json']){
 const data=JSON.parse(await readFile(resolve(root,'scripts/demo/local',name),'utf8'));
 if(name.includes('manifest'))data.rpcUrl='https://openhouse.lockgate.finance/api/demo/rpc/421614';
 files[name]=JSON.stringify(data);
}
for(const name of ['MockUSDG','DemoRegistry','DemoSettlement','DemoFirmVault']){
 const data=JSON.parse(await readFile(resolve(root,`contracts/out/${name}.sol/${name}.json`),'utf8'));
 files[`${name}.json`]=JSON.stringify({abi:data.abi,bytecode:{object:'0x'}});
}
await writeFile(resolve(directory,'build/static-files.json'),JSON.stringify(files));
await build({entryPoints:[resolve(directory,'worker.ts')],outfile:resolve(directory,'build/worker.js'),bundle:true,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],define:{'import.meta.url':JSON.stringify('file:///lockgate/harness/src/demo/server.ts')},plugins:[{name:'durable-filesystem',setup(builder){builder.onResolve({filter:/filesystem\.js$/},()=>({path:resolve(directory,'filesystem.ts')}));}}]});
process.stdout.write('Cloudflare backend bundled with public artifacts only.\n');
