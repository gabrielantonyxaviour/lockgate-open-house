export async function bufferedRequest(request:Request,limit:number):Promise<Request>{
 if(!request.body)return request;
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){
  const chunk=await reader.read();if(chunk.done)break;
  size+=chunk.value.byteLength;
  if(size>limit){await reader.cancel();throw new Error('REQUEST_TOO_LARGE');}
  chunks.push(chunk.value);
 }
 const body=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
 return new Request(request.url,{method:request.method,headers:request.headers,body,redirect:request.redirect});
}
