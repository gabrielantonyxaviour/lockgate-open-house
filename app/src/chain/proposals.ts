import { isAddressEqual, zeroHash, type Address, type Hash } from 'viem';
import { z } from 'zod';
import { vaultAbi } from './abi';
import { CHAIN, DEPLOYMENT } from './config';
import { addressSchema, errorMessage, publicClient, read } from './client';
import { authorizedWallet } from './wallet';
import type { OnTransactionState } from './model';
const jsonUint=z.string().max(78).regex(/^(0|[1-9]\d*)$/).transform(BigInt).refine(n=>n<(1n<<256n),'Value must fit uint256.');
const jsonUint64=jsonUint.refine(n=>n<(1n<<64n),'Timestamp must fit uint64.');
const proposalSchema=z.object({
 platform:addressSchema,recipient:addressSchema,requestId:jsonUint,navValue:jsonUint,fee:jsonUint,payout:jsonUint,feeBps:z.number().int().min(0).max(10000),dueAt:jsonUint64,expiresAt:jsonUint64,nonce:jsonUint,quoteId:z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v as Hash),
}).superRefine((p,ctx)=>{
 if(p.navValue<=0n || p.payout<=0n || p.fee+p.payout!==p.navValue) ctx.addIssue({code:'custom',message:'Positive payout plus fee must equal NAV value.'});
 if(p.platform==='0x0000000000000000000000000000000000000000' || p.recipient==='0x0000000000000000000000000000000000000000') ctx.addIssue({code:'custom',message:'Platform and recipient must be nonzero.'});
});
const knownVault=addressSchema.refine(v=>isAddressEqual(v,DEPLOYMENT.vaultA)||isAddressEqual(v,DEPLOYMENT.vaultB),'Select a deployed Lockgate partner vault.');
const importSchema=z.object({vault:knownVault,chainId:z.literal(CHAIN.id),proposal:proposalSchema});
const filingSchema=z.object({message:proposalSchema,domain:z.object({name:z.literal('LockgateAdvance'),version:z.literal('1'),chainId:z.literal(CHAIN.id),verifyingContract:knownVault})});
export type ImportedProposal=z.infer<typeof importSchema>;
export interface ProposalReview extends ImportedProposal { digest:Hash; filedDigest:Hash; nonceUsed:boolean; reasonCode:number; reason:string; ready:boolean; owner:Address; signer:Address; verifiedAt:number }
const REASONS=['Ready','Paused','Mandate expired','Platform not approved','Recipient mismatch','Platform limit','Concentration limit','Fee outside mandate','Tenor outside mandate','Insufficient idle cash','Insufficient reserve','Peg check failed','Stale oracle','Platform gated','Stale NAV','Zero amount','Deadline expired'];
export function parseProposal(text:string):ImportedProposal {
 z.string().max(32_000).parse(text);
 let input:unknown;
 try {input=JSON.parse(text);} catch {throw new Error('Import valid JSON from the engine proposal output.');}
 const direct=importSchema.safeParse(input);
 if(direct.success) return direct.data;
 const filing=filingSchema.safeParse(input);
 if(filing.success) return {vault:filing.data.domain.verifyingContract,chainId:filing.data.domain.chainId,proposal:filing.data.message};
 throw new Error('Proposal import must include a deployed vault, chain421614, and complete terms with decimal strings for amounts and timestamps.');
}
function validated(payload:ImportedProposal):ImportedProposal {
 return parseProposal(JSON.stringify(payload,(_,v)=>typeof v==='bigint'?v.toString():v));
}
export async function verifyProposal(payload:ImportedProposal):Promise<ProposalReview> {
 const imported=validated(payload);
 if(await publicClient.getChainId()!==CHAIN.id) throw new Error('Proposal verification requires Arbitrum Sepolia.');
 const {vault,proposal}=imported;
 const blockNumber=await publicClient.getBlockNumber();
 const [digest,filedDigest,nonceUsed,reasonCode,owner,mandate]=await Promise.all([
  read<Hash>(vault,vaultAbi,'hashTypedProposal',[proposal],blockNumber),read<Hash>(vault,vaultAbi,'proposalHashOf',[proposal.nonce],blockNumber),read<boolean>(vault,vaultAbi,'nonceUsed',[proposal.nonce],blockNumber),read<number>(vault,vaultAbi,'preview',[proposal],blockNumber),read<Address>(vault,vaultAbi,'owner',[],blockNumber),read<{signer:Address}>(vault,vaultAbi,'mandate',[],blockNumber),
 ]);
 const filed=filedDigest!==zeroHash && digest.toLowerCase()===filedDigest.toLowerCase();
 const reason=nonceUsed ? 'This nonce has already been used or cancelled.' : !filed ? 'The exact engine proposal is not filed in this vault.' : REASONS[reasonCode] ?? 'Contract rejected the proposal.';
 return {...imported,digest,filedDigest,nonceUsed,reasonCode,reason,ready:filed&&!nonceUsed&&reasonCode===0,owner,signer:mandate.signer,verifiedAt:Date.now()};
}
export async function approveProposal(payload:ImportedProposal,account:Address,onState:OnTransactionState=()=>{}):Promise<Hash> {
 let lastHash:Hash|undefined;
 let awaitingReceipt=false;
 try {
  onState({phase:'checking',message:'Verifying the filed engine digest and partner mandate.'});
  const review=await verifyProposal(payload);
  if(!review.ready) throw new Error(review.reason);
  if(!isAddressEqual(account,review.owner)&&!isAddressEqual(account,review.signer)) throw new Error('Only this vault owner or partner signer can approve the proposal.');
  await authorizedWallet(account);
  const simulation=await publicClient.simulateContract({account,address:review.vault,abi:vaultAbi,functionName:'approve',args:[review.proposal]});
  onState({phase:'confirming',message:'Review the exact proposal and authorize funding in your wallet.'});
  const wallet=await authorizedWallet(account);
  const hash=await wallet.writeContract(simulation.request);
  lastHash=hash; awaitingReceipt=true;
  onState({phase:'pending',hash,message:'Waiting for partner approval confirmation.'});
  const receipt=await publicClient.waitForTransactionReceipt({hash});
  awaitingReceipt=false;
  if(receipt.status!=='success') throw new Error('Partner approval reverted.');
  onState({phase:'success',hash,message:'Partner approved and funded this proposal.'});
  return hash;
 } catch(error) {
  onState({phase:'error',hash:lastHash,confirmationUnknown:awaitingReceipt,message:awaitingReceipt ? 'Partner approval submitted; confirmation is unverified. Check the transaction in the explorer before retrying.' : errorMessage(error)});
  throw error;
 }
}
