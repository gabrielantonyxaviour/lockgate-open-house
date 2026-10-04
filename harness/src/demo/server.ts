import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, keccak256, toHex, verifyMessage, type Abi, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { acceptSubscription, createOffers, faucet, gasGrant, mintPosition, prepareSubscription, reserveOffer, resumeSubscription, signExit } from './actions.js';
import { artifact, chain, err, identities, identityHash, manifest, publicClient, walletAt } from './shared.js';
import { demoState, publicStats, receiptFromHash } from './state.js';
import { findEnquiry, newId, newSession, profile, save, saveEnquiry, session, setEnquiryStatus } from './store.js';
import { workspaceAction } from './workspace.js';
import { enqueueAcknowledgement } from './email.js';
import { proxyRpc } from './rpc-proxy.js';
import { changeProfileRole } from './profile-roles.js';

const address=z.string().refine(isAddress,'Invalid wallet address').transform(x=>getAddress(x));
const hex=z.string().regex(/^0x[0-9a-fA-F]+$/).transform(x=>x as Hex);
const amount=z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/,'Invalid 6-decimal amount');
export const challenges=new Map<string,{account:Address;chainId:number;message:string;expiresAt:number}>();
const allowedOrigins=new Set(['https://openhouse.lockgate.finance','http://localhost:5197','http://127.0.0.1:5197']);
const knownRoutes=new Set(['rpc/421614','config','public','challenge','authenticate','state','role','identity','enquiries','offers','reserve-offer','exit-signature','eligibility','subscription','subscription-resume','mint-position','faucet','gas','receipts','workspace-action']);
const enquiry=z.object({role:z.enum(['originator','manager']),representative:z.string().trim().min(2).max(100),email:z.string().trim().email().max(254),organization:z.string().trim().min(2).max(150),jurisdiction:z.string().trim().min(2).max(100),summary:z.string().trim().min(20).max(1500),requestId:z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()});

function json(res:ServerResponse,status:number,value:unknown) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage) {
 let text='';for await(const chunk of req){text+=String(chunk);if(text.length>65536) err('Request too large','REQUEST_TOO_LARGE',413);}
 try{return JSON.parse(text||'{}') as unknown;}catch{err('Invalid JSON','INVALID_JSON');}
}
function bearer(req:IncomingMessage):Address {
 const token=req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
 if(!token) err('Wallet session required','AUTH_REQUIRED',401);
 const account=session(token);if(!account) err('Wallet session expired','AUTH_REQUIRED',401);
 return account;
}
function config() {
 const m=manifest();return {chainId:m.chainId,rpcUrl:m.rpcUrl,asset:m.asset,registry:m.registry,settlement:m.settlement,vaults:m.vaults,originators:m.originators,abis:{asset:(artifact('MockUSDG').abi as Abi).filter(item=>item.type!=='function'||item.name!=='mint'),registry:artifact('DemoRegistry').abi,settlement:artifact('DemoSettlement').abi,vault:artifact('DemoFirmVault').abi},network:process.env.LOCKGATE_DEMO_NETWORK==='arbitrum-sepolia'?'Arbitrum Sepolia':'Local EVM test network',walletRpcUrl:'https://sepolia-rollup.arbitrum.io/rpc'};
}
async function handle(req:IncomingMessage,res:ServerResponse) {
 const origin=req.headers.origin;if(origin&&!allowedOrigins.has(origin)) err('Untrusted browser origin','ORIGIN_FORBIDDEN',403);
 if(origin){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-headers','content-type, authorization');res.setHeader('access-control-allow-methods','GET, POST, OPTIONS');}
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json')) err('Use application/json','CONTENT_TYPE_REQUIRED',415);
 const path=new URL(req.url??'/',`http://127.0.0.1:8788`).pathname;
 if(!path.startsWith('/api/demo/')||!knownRoutes.has(path.slice('/api/demo/'.length))) err('Route not found','NOT_FOUND',404);
 if(path==='/api/demo/rpc/421614'&&req.method==='POST')return json(res,200,await proxyRpc(await body(req)));
 if(await publicClient.getChainId()!==chain.id) err('Arbitrum Sepolia is unavailable or the RPC uses another chain','CHAIN_UNAVAILABLE',503);
 if(path==='/api/demo/config'&&req.method==='GET') return json(res,200,config());
 if(path==='/api/demo/public'&&req.method==='GET') return json(res,200,await publicStats());
 if(path==='/api/demo/challenge'&&req.method==='POST') {
  const v=z.object({account:address,chainId:z.number().int()}).parse(await body(req));
  if(v.chainId!==chain.id) err('Connect Arbitrum Sepolia','WRONG_CHAIN',409);
  const nonce=randomBytes(16).toString('hex');
  for(const [key,item] of challenges)if(item.expiresAt<Date.now())challenges.delete(key);
  if(challenges.size>=1000) err('Too many pending challenges','RATE_LIMITED',429);
  const message=`Lockgate wallet sign-in\nAccount: ${v.account}\nNetwork: Arbitrum Sepolia (${chain.id})\nOrigin: ${origin??process.env.LOCKGATE_PUBLIC_ORIGIN??'http://127.0.0.1:5197'}\nNonce: ${nonce}\nExpires: ${new Date(Date.now()+5*60_000).toISOString()}\nThis signature signs you in. It does not move funds.`;
  challenges.set(nonce,{account:v.account,chainId:v.chainId,message,expiresAt:Date.now()+5*60_000});
  return json(res,200,{message,nonce});
 }
 if(path==='/api/demo/authenticate'&&req.method==='POST') {
  const v=z.object({account:address,chainId:z.number().int(),message:z.string().max(500),nonce:z.string().regex(/^[0-9a-f]{32}$/),signature:hex}).parse(await body(req));
  const c=challenges.get(v.nonce);challenges.delete(v.nonce);
  if(!c||c.expiresAt<Date.now()||c.account!==v.account||c.chainId!==v.chainId||c.message!==v.message) err('Challenge missing or expired','CHALLENGE_INVALID',401);
  if(!(await verifyMessage({address:v.account,message:v.message,signature:v.signature}))) err('Wallet signature did not verify','BAD_SIGNATURE',403);
  const token=newSession(v.account);return json(res,200,{token,state:await demoState(v.account)});
 }
 const account=bearer(req);
 if(path==='/api/demo/state'&&req.method==='GET') return json(res,200,await demoState(account));
 if(path==='/api/demo/role'&&req.method==='POST') {
  const {role,intent}=z.object({role:z.enum(['investor','originator','manager','provider']),intent:z.enum(['create','switch']).default('create')}).parse(await body(req));
  const p=profile(account),m=manifest(),identity=identities.find(i=>i.id===p.identityId);
  const bound=identity?Boolean(await publicClient.readContract({address:m.registry,abi:artifact('DemoRegistry').abi as Abi,functionName:'matches',args:[account,identityHash(identity.identityRef)]})):false;
  const approved=role==='originator'?m.originators.some(o=>o.address.toLowerCase()===account.toLowerCase()):role==='manager'&&m.vaults.some(v=>v.manager.toLowerCase()===account.toLowerCase());
  changeProfileRole(p,role,intent,bound,approved);save();return json(res,200,await demoState(account));
 }
 if(path==='/api/demo/identity'&&req.method==='POST') {
  const {profileId}=z.object({profileId:z.string().min(1).max(80)}).parse(await body(req));
  const identity=identities.find(i=>i.id===profileId);if(!identity) err('Unknown TEST profile','UNKNOWN_IDENTITY',404);
  const p=profile(account);if(p.role!=='investor'&&p.role!=='provider') err('Choose investor or provider role first','ROLE_REQUIRED',403);
  const m=manifest(),hash=identityHash(identity.identityRef),existing=await publicClient.readContract({address:m.registry,abi:artifact('DemoRegistry').abi as Abi,functionName:'identityWallet',args:[hash]}) as Address;
  if(existing!=='0x0000000000000000000000000000000000000000'&&existing.toLowerCase()!==account.toLowerCase()) err('TEST profile is already bound to a wallet','IDENTITY_TAKEN',409);
  const validUntil=(await publicClient.getBlock()).timestamp+24n*3600n,nonce=BigInt(`0x${randomBytes(8).toString('hex')}`);
  const signature=await walletAt(0).signTypedData({domain:{name:'LockgateTestIdentity',version:'1',chainId:chain.id,verifyingContract:m.registry},types:{Identity:[{name:'wallet',type:'address'},{name:'identity',type:'bytes32'},{name:'validUntil',type:'uint64'},{name:'nonce',type:'uint256'}]},primaryType:'Identity',message:{wallet:account,identity:hash,validUntil,nonce}});
  if(!p.firstHoldingProfileId&&identity.fixtureCase==='match')p.firstHoldingProfileId=identity.id;
  p.identityId=identity.id;save();
  return json(res,200,{identity:hash,validUntil:String(validUntil),nonce:String(nonce),signature,registry:m.registry,profile:identity});
 }
 if(path==='/api/demo/enquiries'&&req.method==='POST') {
  const submitted=enquiry.parse(await body(req));const {requestId:clientId,...fields}=submitted;
  const requestId=clientId??keccak256(toHex(JSON.stringify({account,...fields})));
  const prior=findEnquiry(account,requestId);
  if(prior&&JSON.stringify(prior.fields)!==JSON.stringify(fields)) err('Request ID was already used for a different enquiry','IDEMPOTENCY_CONFLICT',409);
  const reference=prior?.reference??newId('ENQ'),receivedAt=prior?.receivedAt??new Date().toISOString();
  if(!prior)saveEnquiry({reference,requestId,receivedAt,emailStatus:'Queued locally; delivery unconfirmed',account,fields});
  const result=await enqueueAcknowledgement(fields,reference);
  setEnquiryStatus(reference,result.emailStatus);
  return json(res,prior?200:201,{reference,receivedAt,emailStatus:result.emailStatus});
 }
 if(path==='/api/demo/offers'&&req.method==='POST') {
  const v=z.object({positionId:z.string().regex(/^0x[0-9a-fA-F]{64}$/),amount}).parse(await body(req));
  return json(res,200,await createOffers(account,v.positionId,v.amount));
 }
 if(path==='/api/demo/reserve-offer'&&req.method==='POST') {
  const {offerId}=z.object({offerId:z.string().min(1).max(80)}).parse(await body(req));return json(res,200,await reserveOffer(account,offerId));
 }
 if(path==='/api/demo/exit-signature'&&req.method==='POST') {
  const v=z.object({offerId:z.string().min(1).max(80),signature:hex,typedName:z.string().trim().min(2).max(100),consent:z.literal(true)}).parse(await body(req));return json(res,200,await signExit(account,v.offerId,v.signature,v.typedName,v.consent));
 }
 if(path==='/api/demo/eligibility'&&req.method==='POST') {
  const {vehicleId}=z.object({vehicleId:z.string().min(1).max(80)}).parse(await body(req));
  if(!manifest().vaults.some(v=>v.id===vehicleId)) err('Unknown vehicle','NOT_FOUND',404);
  return json(res,200,await demoState(account));
 }
 if(path==='/api/demo/subscription'&&req.method==='POST') {
  const v=z.object({vehicleId:z.string().min(1).max(80),amount,signature:hex.optional(),typedName:z.string().trim().min(2).max(100).optional(),consent:z.boolean().optional(),digest:hex.optional()}).parse(await body(req));
  if(v.signature){if(!v.typedName||v.consent!==true||!v.digest)err('Typed full name, consent and exact document digest are required','SIGNED_PACKAGE_REQUIRED');return json(res,200,await acceptSubscription(account,v.vehicleId,v.amount,v.signature,v.typedName,v.consent,v.digest));}
  if(v.typedName||v.digest||v.consent!==undefined)err('Prepare the exact letter before supplying acceptance fields','SIGNED_PACKAGE_REQUIRED');
  return json(res,200,await prepareSubscription(account,v.vehicleId,v.amount));
 }
 if(path==='/api/demo/subscription-resume'&&req.method==='POST') {
  const v=z.object({vehicleId:z.string().min(1).max(80),amount}).parse(await body(req));
  return json(res,200,await resumeSubscription(account,v.vehicleId,v.amount));
 }
 if(path==='/api/demo/mint-position'&&req.method==='POST') return json(res,200,await mintPosition(account));
 if(path==='/api/demo/faucet'&&req.method==='POST') return json(res,200,await faucet(account));
 if(path==='/api/demo/gas'&&req.method==='POST') return json(res,200,await gasGrant(account));
 if(path==='/api/demo/receipts'&&req.method==='POST') {
  const v=z.object({hash:hex,title:z.string().trim().min(3).max(100),amount:amount.optional()}).parse(await body(req));
  const r=await receiptFromHash(account,v.hash,v.title,v.amount);save();return json(res,200,r);
 }
 if(path==='/api/demo/workspace-action'&&req.method==='POST') {
  const v=z.object({actionId:z.string().min(1).max(80),inputs:z.record(z.string()).default({})}).parse(await body(req));
  return json(res,200,await workspaceAction(account,v.actionId,v.inputs));
 }
 err('Route not found','NOT_FOUND',404);
}

export async function handleRequest(req:IncomingMessage,res:ServerResponse){return handle(req,res).catch(e=>{
 const known=typeof e?.status==='number'&&typeof e?.code==='string'&&/^[A-Z_]+$/.test(e.code);
 const status=e instanceof z.ZodError?400:known?e.status:500;
 const code=e instanceof z.ZodError?'INVALID_INPUT':known?e.code:'INTERNAL_ERROR';
 const error=status>=500?'The service could not complete the request':e instanceof z.ZodError?e.issues[0]?.message??'Invalid input':e?.message??'Request failed';
 json(res,status,{error,code});
});}
if(process.env.LOCKGATE_RUNTIME!=='cloudflare'){
 const server=createServer(handleRequest);
 server.listen(8788,'127.0.0.1',()=>process.stdout.write('Lockgate local TEST API ready at http://127.0.0.1:8788\n'));
}
