import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../harness/src/demo/server.js';

export async function apiResponse(request:Request):Promise<Response>{
 const headers=new Headers();let status=200,result='';
 const input={method:request.method,url:request.url,headers:Object.fromEntries(request.headers),async *[Symbol.asyncIterator](){if(!request.body)return;const reader=request.body.getReader();try{for(;;){const chunk=await reader.read();if(chunk.done)break;yield Buffer.from(chunk.value);}}finally{reader.releaseLock();}}};
 const output={setHeader(name:string,value:string){headers.set(name,value);},writeHead(code:number,values?:Record<string,string>){status=code;for(const [name,value]of Object.entries(values??{}))headers.set(name,value);},end(value?:string){result=value??'';}};
 await handleRequest(input as unknown as IncomingMessage,output as unknown as ServerResponse);
 return new Response(status===204?null:result,{status,headers});
}
