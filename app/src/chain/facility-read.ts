import { isAddressEqual, type Abi, type Address } from 'viem';
import { DEPLOYMENT } from './config';
import { facilityAbi } from './facility-abi';
import type { Facility, FacilityAccounting } from './facility-model';
type Read = <T>(address:Address,abi:Abi,name:string,args?:readonly unknown[],blockNumber?:bigint)=>Promise<T>;
export async function readFacility(account:Address|undefined,blockNumber:bigint,read:Read):Promise<Facility> {
 const f=<T>(name:string,args:readonly unknown[]=[])=>read<T>(DEPLOYMENT.facility,facilityAbi,name,args,blockNumber);
 const [governor,borrower,asset,receivables,accounting,borrowingBase,availableDraw,solvent,lenderCount,seniorSupply,juniorSupply]=await Promise.all([
  f<Address>('governor'),f<Address>('borrower'),f<Address>('asset'),f<Address>('receivables'),f<FacilityAccounting>('accounting'),
  f<bigint>('borrowingBase'),f<bigint>('availableDraw'),f<boolean>('solvent'),f<bigint>('lenderCount'),f<bigint>('seniorSupply'),f<bigint>('juniorSupply'),
 ]);
 if(!isAddressEqual(asset,DEPLOYMENT.usdg)) throw new Error('The facility asset does not match the configured USDG token.');
 const [approvedLender,seniorShares,juniorShares,seniorClaim,juniorClaim,seniorIndex,juniorIndex,seniorIndexOf,juniorIndexOf]=account ? await Promise.all([
  f<boolean>('approvedLender',[account]),f<bigint>('seniorShares',[account]),f<bigint>('juniorShares',[account]),
  f<bigint>('seniorClaim',[account]),f<bigint>('juniorClaim',[account]),f<bigint>('seniorIndex'),f<bigint>('juniorIndex'),
  f<bigint>('seniorIndexOf',[account]),f<bigint>('juniorIndexOf',[account]),
 ]) : [false,0n,0n,0n,0n,0n,0n,0n,0n] as const;
 if(seniorIndex<seniorIndexOf || juniorIndex<juniorIndexOf) throw new Error('The facility interest index is inconsistent.');
 const seniorIdle=accounting.seniorPrincipal-accounting.seniorDrawn;
 const juniorIdle=accounting.juniorPrincipal-(accounting.drawn-accounting.seniorDrawn);
 if(seniorIdle<0n || juniorIdle<0n) throw new Error('The facility principal accounting is inconsistent.');
 return {address:DEPLOYMENT.facility,governor,borrower,asset,receivables,accounting,borrowingBase,availableDraw,solvent,lenderCount,seniorSupply,juniorSupply,
  approvedLender,seniorShares,juniorShares,seniorIdle,juniorIdle,
  seniorClaimable:seniorClaim+seniorShares*(seniorIndex-seniorIndexOf)/10n**27n,
  juniorClaimable:juniorClaim+juniorShares*(juniorIndex-juniorIndexOf)/10n**27n};
}
