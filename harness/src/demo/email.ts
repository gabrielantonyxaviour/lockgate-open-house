import { mkdirSync, readFileSync, renameSync, writeFileSync } from './filesystem.js';
import { fileURLToPath, URL } from 'node:url';
import { z } from 'zod';
const fieldsSchema=z.object({representative:z.string().min(2).max(100),email:z.string().email().max(254),organization:z.string().min(2).max(150),role:z.enum(['originator','manager'])});
type Fields=z.infer<typeof fieldsSchema>;
type Outbox={reference:string;to:string;subject:string;html:string;text:string;status:'queued'|'accepted'|'retry';providerId?:string;updatedAt:string};
const directory=fileURLToPath(new URL('../../../scripts/demo/local/email/',import.meta.url));
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function acknowledgement(fields:Fields,reference:string) {
 const label=fields.role==='originator'?'originating platform':'investment firm';
 const text=`Hi ${fields.representative},\n\nWe have received your enquiry about onboarding ${fields.organization} as an ${label}.\n\nOur team will review your details and get back to you about the next steps. Your enquiry reference is ${reference}.\n\nThis acknowledgement confirms receipt. Institutional approval, due diligence and agreements follow separately.\n\nLockgate\ngabriel@lockgate.finance`;
 const html=`<!doctype html><html><body style="margin:0;background:#f6f6f5;font-family:Arial,Helvetica,sans-serif;color:#171717"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" align="center" width="560" style="max-width:100%;background:#fff;border:1px solid #e5e5e5;border-radius:12px"><tr><td style="padding:32px"><div style="font-size:28px;font-weight:700;letter-spacing:-1px">Lockgate<span style="color:#8b8b8b">.</span></div><h1 style="font-size:24px;line-height:1.3;margin:32px 0 20px">We’ve received your enquiry.</h1><p style="font-size:16px;line-height:1.6">Hi ${escape(fields.representative)},</p><p style="font-size:16px;line-height:1.6">Thank you for getting in touch about onboarding <strong>${escape(fields.organization)}</strong> as an ${label}.</p><p style="font-size:16px;line-height:1.6">Our team will review your details and get back to you about the next steps.</p><p style="background:#f6f6f5;padding:16px;border-radius:8px;font-size:14px">Enquiry reference: <strong>${escape(reference)}</strong></p><p style="font-size:13px;color:#666;line-height:1.6">This acknowledgement confirms receipt. Institutional approval, due diligence and agreements follow separately.</p><p style="margin-top:28px;font-size:14px"><a style="color:#171717" href="mailto:gabriel@lockgate.finance">gabriel@lockgate.finance</a></p></td></tr></table></td></tr></table></body></html>`;
 return {subject:'Lockgate — your enquiry is received',html,text};
}
function persist(path:string,item:Outbox){mkdirSync(directory,{recursive:true});const tmp=`${path}.${process.pid}.tmp`;writeFileSync(tmp,JSON.stringify(item,null,2),{mode:0o600});renameSync(tmp,path);}
export async function enqueueAcknowledgement(input:Fields,reference:string):Promise<{emailStatus:string}> {
 const fields=fieldsSchema.parse(input);if(!/^ENQ-[\da-f]{12}$/.test(reference))throw new Error('Invalid enquiry reference');
 const path=`${directory}${reference}.json`;
 let item:Outbox;
 try{item=JSON.parse(readFileSync(path,'utf8')) as Outbox;}catch{item={reference,to:fields.email,...acknowledgement(fields,reference),status:'queued',updatedAt:new Date().toISOString()};persist(path,item);}
 if(item.status==='accepted')return {emailStatus:'Accepted by email provider'};
 const key=process.env.LOCKGATE_RESEND_API_KEY,from=process.env.LOCKGATE_EMAIL_FROM;
 if(!key||!from||!/@lockgate\.finance>?$/i.test(from))return {emailStatus:'Queued — verified Lockgate email sender required'};
 try {
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`lockgate-enquiry-${reference}`},body:JSON.stringify({from,to:[item.to],reply_to:'gabriel@lockgate.finance',subject:item.subject,html:item.html,text:item.text}),signal:AbortSignal.timeout(15_000)});
  const result=z.object({id:z.string()}).safeParse(await response.json());
  if(!response.ok||!result.success)throw new Error('Email provider rejected the acknowledgement');
  item.status='accepted';item.providerId=result.data.id;item.updatedAt=new Date().toISOString();persist(path,item);
  return {emailStatus:'Accepted by email provider'};
 } catch {item.status='retry';item.updatedAt=new Date().toISOString();persist(path,item);return {emailStatus:'Queued for retry — email delivery unconfirmed'};}
}
