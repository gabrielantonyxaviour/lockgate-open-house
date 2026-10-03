import { z } from 'zod';
import { addressSchema } from './client';
const amount=z.string().min(1).max(100);
const uint=z.bigint().min(1n).max((1n<<256n)-1n);
const platform={platform:addressSchema};
const bps=z.number().int().min(0).max(10000);
const uint64=z.bigint().min(0n).max((1n<<64n)-1n);
const quote={minUsdgOut:uint,quotedAt:z.number().finite()};
const single=(kind:string,shape:Record<string,z.ZodType>={})=>z.object({kind:z.literal(kind),...shape});
export const actionSchema=z.discriminatedUnion('kind',[
 single('createPlatform',{platformKind:z.union([z.literal(1),z.literal(2),z.literal(3)]),name:z.string().trim().min(1).max(64).refine(value=>!Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127),'Use a platform name without control characters.'),interval:z.bigint().min(60n).max(31536000n),shareNav:amount,issuer:addressSchema.refine(value=>value!=='0x0000000000000000000000000000000000000000','Issuer must be nonzero.'),limit:amount,reserveBps:z.number().int().min(500).max(1000)}),
 single('deposit',{...platform,amount}),single('depositCash',{...platform,amount}),single('requestRedeem',{...platform,amount}),
 single('exitNow',{...platform,amount,...quote}),single('exitEarly',{...platform,requestId:uint,...quote}),
 single('cancel',{...platform,requestId:uint}),single('processWindow',platform),single('setNav',{...platform,amount}),single('setGated',{...platform,gated:z.boolean()}),
 single('registerSource',{...platform,amount,reserveBps:bps}),single('vaultSetPlatform',{...platform,vault:addressSchema,approved:z.boolean(),amount,reserveBps:bps,checkGate:z.boolean(),maxNavAge:uint64}),
 single('setAllowlist',{...platform,account:addressSchema,allowed:z.boolean()}),single('setSourceTerms',{...platform,amount,reserveBps:bps,riskBps:bps}),single('setCaps',{maxUtilizationBps:bps,maxConcentrationBps:bps}),single('setGrace',{seconds:uint64}),single('vaultSetPaused',{vault:addressSchema,paused:z.boolean()}),single('vaultSetMandate',{vault:addressSchema,minFeeBps:bps,maxTenor:uint64,concentrationBps:bps,expiry:uint64}),
 single('depositCapital',{amount}),single('withdrawCapital',{amount}),single('pause'),single('unpause'),single('postReserve',{...platform,amount}),single('markLate',{advanceId:uint}),single('vaultDeposit',{vault:addressSchema,amount}),single('vaultWithdraw',{vault:addressSchema,amount}),
]);
