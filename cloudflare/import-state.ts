import { z } from '../harness/node_modules/zod/index.js';
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const profile=z.object({role:z.enum(['investor','originator','manager','provider']).optional(),identityId:z.string().optional(),agreements:z.record(z.unknown()),receipts:z.array(z.object({id:z.string(),account:address,status:z.enum(['submitted','confirmed','reverted','unknown'])}).passthrough()),offers:z.array(z.object({id:z.string(),account:address}).passthrough()),minted:z.array(z.object({id:z.string(),identityId:z.string()}).passthrough())}).passthrough();
const stored=z.object({profiles:z.record(profile),sessions:z.record(z.object({account:address,createdAt:z.string().datetime()})),enquiries:z.array(z.object({reference:z.string(),account:address,requestId:z.string(),receivedAt:z.string(),emailStatus:z.string(),fields:z.record(z.string())}))}).passthrough();
const envelope=z.object({state:stored,outbox:z.record(z.object({reference:z.string(),status:z.enum(['queued','accepted','retry'])}).passthrough()).default({})});
export async function parseImport(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('Use application/json');
 let text='';const reader=request.body?.getReader();if(!reader)throw new Error('State body required');
 const decoder=new TextDecoder();let bytes=0;
 for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>8_000_000){await reader.cancel();throw new Error('Import exceeds 8MB');}text+=decoder.decode(chunk.value,{stream:true});}
 text+=decoder.decode();const input=JSON.parse(text);
 const parsed=envelope.parse(input.state?input:{state:input});
 for(const [key,item]of Object.entries(parsed.outbox))if(!/^ENQ-[a-f0-9]{12}$/.test(key)||item.reference!==key)throw new Error('Invalid email outbox reference');
 return parsed;
}
