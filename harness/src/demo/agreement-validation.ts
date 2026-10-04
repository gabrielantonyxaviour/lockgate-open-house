import { keccak256, toHex, verifyMessage, type Address, type Hex } from 'viem';
import type { PendingSubscription } from './store.js';

const reject=(message:string,code:string,status=409):never=>{throw Object.assign(new Error(message),{code,status});};
const normalized=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en');

export function requireVerifiedFullName(typedName:string,expectedName:string,consent:boolean){
 if(!consent||normalized(typedName)!==normalized(expectedName))reject('Type the full verified TEST profile name and accept this letter','SIGNER_NAME_MISMATCH',403);
}

export function requireExactDocument(message:string,digest:Hex,committedHash:Hex){
 if(keccak256(toHex(message))!==digest||digest!==committedHash)reject('The document no longer matches its signed commitment','DOCUMENT_MISMATCH');
}

export async function verifySubscriptionAcceptance(input:{
 pending:PendingSubscription;account:Address;signature:Hex;typedName:string;consent:boolean;
 expectedName:string;amount:string;digest:Hex;vault:Address;termsHash:Hex;
 nowMs:number;chainTimestamp:bigint;
}){
 const {pending:p}=input;
 if(p.version!=='2'||p.amount!==input.amount||p.expiresAt<=input.nowMs||BigInt(p.fundingDeadline)<=input.chainTimestamp)reject('Prepare exact subscription letter again','TERMS_STALE');
 requireVerifiedFullName(input.typedName,input.expectedName,input.consent);
 if(p.signerName!==input.expectedName||p.vault.toLowerCase()!==input.vault.toLowerCase()||p.termsHash!==input.termsHash)reject('The accepted document differs from the prepared letter','DOCUMENT_MISMATCH');
 requireExactDocument(p.message,p.digest,input.digest);
 if(!(await verifyMessage({address:input.account,message:p.message,signature:input.signature})))reject('Wallet signature does not match exact letter','BAD_SIGNATURE',403);
}
