import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
export async function signedSource() {
  const files:{path:string;sha256:string}[]=[];
  const walk=async(path:string)=>{
    for(const entry of await readdir(path,{withFileTypes:true})){
      const file=join(path,entry.name);
      if(entry.isDirectory())await walk(file);
      else files.push({path:file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
    }
  };
  await walk('src');files.sort((a,b)=>a.path.localeCompare(b.path));
  return{gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtySource:execFileSync('git',['status','--porcelain','--','src'],{encoding:'utf8'}).trim(),sourceTreeSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
