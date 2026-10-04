import { mkdirSync, readFileSync, statSync, writeFileSync } from './filesystem.js';
import { fileURLToPath, URL } from 'node:url';
import { generatePrivateKey, nonceManager, privateKeyToAccount } from 'viem/accounts';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

export const publicSignersPath=fileURLToPath(new URL('../../../scripts/demo/local/public-sepolia-signers.json',import.meta.url));
const role=(index:number)=>index===0?'identity-admin':index<=5?'originator':index<=10?'firm-manager':'seed-provider';
const key=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const signerSchema=z.object({index:z.number().int().min(0).max(15),role:z.string(),address:z.string().refine(isAddress),privateKey:key});
const fileSchema=z.object({version:z.literal(1),network:z.literal('arbitrum-sepolia'),signers:z.array(signerSchema).length(16)});
type SignerFile=z.infer<typeof fileSchema>;
let cached:ReturnType<typeof privateKeyToAccount>[]|undefined;

function readSigners():SignerFile {
 const mode=statSync(publicSignersPath).mode;
 if((mode&0o077)!==0)throw new Error('Sepolia signer file must be readable only by its owner');
 const parsed=fileSchema.safeParse(JSON.parse(readFileSync(publicSignersPath,'utf8')));
 if(!parsed.success)throw new Error('Sepolia signer file is invalid');
 const seen=new Set<string>();
 for(let i=0;i<16;i++){
  const s=parsed.data.signers[i];
  if(s.index!==i||s.role!==role(i))throw new Error('Sepolia signer index or role mismatch');
  const derived=privateKeyToAccount(s.privateKey as Hex).address;
  if(derived.toLowerCase()!==s.address.toLowerCase()||seen.has(derived.toLowerCase()))throw new Error('Sepolia signer address mismatch');
  seen.add(derived.toLowerCase());
 }
 return parsed.data;
}

export function publicAccountAt(index:number){
 if(!Number.isInteger(index)||index<0||index>15)throw new Error('Sepolia signer index out of range');
 cached??=readSigners().signers.map(s=>privateKeyToAccount(s.privateKey as Hex,{nonceManager}));
 return cached[index];
}

export function publicSignerAddresses():{index:number;role:string;address:Address}[]{
 return readSigners().signers.map(s=>({index:s.index,role:s.role,address:getAddress(s.address)}));
}

export function generatePublicSigners():void {
 const signers=Array.from({length:16},(_,index)=>{
  const privateKey=generatePrivateKey();
  return {index,role:role(index),address:privateKeyToAccount(privateKey).address,privateKey};
 });
 mkdirSync(fileURLToPath(new URL('../../../scripts/demo/local/',import.meta.url)),{recursive:true,mode:0o700});
 writeFileSync(publicSignersPath,JSON.stringify({version:1,network:'arbitrum-sepolia',signers},null,2)+'\n',{flag:'wx',mode:0o600});
 const addresses=publicSignerAddresses();
 process.stdout.write(`${JSON.stringify({created:true,signers:addresses})}\n`);
}

if(process.argv.includes('--generate')){
 try{generatePublicSigners();}catch(e){process.stderr.write(`${e instanceof Error?e.message:'Signer generation failed'}\n`);process.exitCode=1;}
}
if(process.argv.includes('--list')){
 try{process.stdout.write(`${JSON.stringify({signers:publicSignerAddresses()})}\n`);}catch{process.stderr.write('Sepolia signer file is unavailable or invalid\n');process.exitCode=1;}
}
