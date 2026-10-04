import { z } from 'zod';
import type { Address, Hex } from 'viem';
const address = z.string().regex(/^0x[\da-f]{40}$/i);
const hex = z.string().regex(/^0x[\da-f]*$/i);
export const configuration = z.object({ chainId:z.literal(421614), rpcUrl:z.string().url(), asset:address, registry:address, settlement:address }).passthrough();
export type Configuration = z.infer<typeof configuration>;
export type Quote = { holdingId:Hex; vault:Address; investor:Address; identity:Hex; units:bigint; payout:bigint; repayment:bigint; route:number; deadline:bigint; maturity:bigint; nonce:bigint; agreementHash:Hex };
export const quoteSchema = z.object({ holdingId:hex, vault:address, investor:address, identity:hex, units:z.coerce.bigint().positive(), payout:z.coerce.bigint().positive(), repayment:z.coerce.bigint().positive(), route:z.union([z.literal(1),z.literal(2)]), deadline:z.coerce.bigint().positive(), maturity:z.coerce.bigint().positive(), nonce:z.coerce.bigint().nonnegative(), agreementHash:hex });
export const receiptSchema = z.object({id:z.string(),title:z.string(),status:z.enum(['submitted','confirmed','reverted','unknown']),hash:hex.optional(),amount:z.string().optional(),residual:z.string().optional(),createdAt:z.string(),account:address,detail:z.string().optional()});
export const stateSchema = z.object({profile:z.object({roles:z.array(z.enum(['investor','originator','manager','provider'])),activeRole:z.enum(['investor','originator','manager','provider']).optional()}).passthrough(),positions:z.array(z.object({id:z.string(),name:z.string(),originator:z.string(),instrument:z.string(),available:z.string(),faceValue:z.string(),partial:z.boolean()}).passthrough()),positionStatus:z.enum(['matched','empty','mismatch','unavailable']),vehicles:z.array(z.object({id:z.string(),name:z.string(),firm:z.string(),cash:z.string(),nav:z.string(),policy:z.string(),minimum:z.string(),eligible:z.boolean(),eligibilityStatus:z.string()}).passthrough()),receipts:z.array(receiptSchema),setup:z.object({gas:z.string(),usdg:z.string(),canMint:z.boolean(),canFund:z.boolean()}).passthrough(),deploymentReady:z.boolean()}).passthrough();
export class DemoTransport {
 token?:string;
 async request<T=unknown>(path:string,body?:unknown):Promise<T> {
  const response=await fetch(`/api/demo/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(this.token?{Authorization:`Bearer ${this.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  let result:unknown;
  try { result=await response.json(); } catch { throw new Error('The demo service is unavailable. No action was confirmed.'); }
  if(!response.ok) { const error=z.object({error:z.string()}).safeParse(result); throw new Error(error.success?error.data.error:'The service rejected this action.'); }
  return result as T;
 }
}
export const identityResponse=z.object({identity:hex,validUntil:z.coerce.bigint(),nonce:z.coerce.bigint(),signature:hex,registry:address});
export const subscriptionResponse=z.object({id:z.coerce.bigint(),termsHash:hex,vault:address,minUnits:z.coerce.bigint(),receipt:z.object({hash:hex,status:z.enum(['confirmed','submitted','unknown','reverted'])}).passthrough().optional()});
