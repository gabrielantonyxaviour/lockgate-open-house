import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address, Hex } from 'viem';

export type ReceiptRecord={id:string;title:string;status:'submitted'|'confirmed'|'reverted'|'unknown';hash?:Hex;amount?:string;residual?:string;createdAt:string;account:Address;detail?:string};
export type OfferRecord={id:string;account:Address;vehicleId:string;holdingId:Hex;quote:Record<string,string|number>;residualUnits:string;originatorSignature:Hex;investorSignature?:Hex;signedAt?:string;agreement:{id:string;version:string;title:string;text:string;digest:Hex;signed:boolean;accepted:boolean};reserveHash?:Hex;cancelled?:boolean;createdAt:string};
export type SubscriptionAgreement={digest:Hex;amount:string;message?:string;signature:Hex;signedAt?:string;subscriptionId?:string;minUnits?:string;txHash?:Hex};
export type ProfileRecord={role?:'investor'|'originator'|'manager'|'provider';identityId?:string;firstHoldingProfileId?:string;agreements:Record<string,SubscriptionAgreement>;agreementHistory?:{vehicleId:string;agreement:SubscriptionAgreement}[];pendingSubscriptions?:Record<string,{amount:string;message:string;expiresAt:number}>;receipts:ReceiptRecord[];offers:OfferRecord[];minted:{id:Hex;identityId:string;name:string;originator:string;originatorAddress:Address;units:string}[];faucetHash?:Hex;gasHash?:Hex};
type Stored={profiles:Record<string,ProfileRecord>;sessions:Record<string,{account:Address;createdAt:string}>;enquiries:{reference:string;requestId:string;receivedAt:string;emailStatus:string;account:Address;fields:Record<string,string>}[]};
const path=fileURLToPath(new URL(process.env.LOCKGATE_DEMO_NETWORK==='arbitrum-sepolia'?'../../../scripts/demo/local/public-sepolia-state.json':'../../../scripts/demo/local/state.json',import.meta.url));
const empty=():Stored=>({profiles:{},sessions:{},enquiries:[]});
let data:Stored;
try { data=JSON.parse(readFileSync(path,'utf8')) as Stored; } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; data=empty(); }
const persist=()=>{mkdirSync(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(temp,path);};
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function newSession(account:Address) { const token=randomBytes(32).toString('hex');const now=Date.now();for(const [key,value] of Object.entries(data.sessions))if(now-Date.parse(value.createdAt)>24*3600_000)delete data.sessions[key];data.sessions[tokenHash(token)]={account,createdAt:new Date(now).toISOString()};persist();return token; }
export function session(token:string) {const item=data.sessions[tokenHash(token)];return item&&Date.now()-Date.parse(item.createdAt)<=24*3600_000?item.account:undefined; }
export function profile(account:Address):ProfileRecord {const key=account.toLowerCase(); return data.profiles[key]??={agreements:{},receipts:[],offers:[],minted:[]};}
export function save(){persist();}
export function saveEnquiry(entry:Stored['enquiries'][number]) {data.enquiries.push(entry);persist();}
export function findEnquiry(account:Address,requestId:string){return data.enquiries.find(x=>x.account.toLowerCase()===account.toLowerCase()&&x.requestId===requestId);}
export function setEnquiryStatus(reference:string,emailStatus:string){const item=data.enquiries.find(x=>x.reference===reference);if(item){item.emailStatus=emailStatus;persist();}}
export function newId(prefix:string){return `${prefix}-${randomBytes(6).toString('hex')}`;}
