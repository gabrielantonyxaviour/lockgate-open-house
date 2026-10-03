import { parseUnits } from 'viem';
import { z } from 'zod';
const UINT256_MAX = (1n << 256n)-1n;
export function parseAmount(value: string, decimals = 6): bigint {
 const amount=parseNonnegativeAmount(value,decimals);
 if(amount===0n) throw new Error('Amount must be positive and fit a uint256.');
 return amount;
}
export function parseNonnegativeAmount(value:string,decimals=6):bigint {
 z.number().int().min(0).max(18).parse(decimals);
 const input = z.string().max(100).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Use a decimal amount without spaces, signs, or exponents.').parse(value);
 if((input.split('.')[1]?.length ?? 0)>decimals) throw new Error(`Use at most ${decimals} decimal places.`);
 const amount = parseUnits(input,decimals);
 if(amount>UINT256_MAX) throw new Error('Amount must fit a uint256.');
 return amount;
}
export function checkedUint(value:bigint,positive=true):bigint {
 z.bigint().min(positive ? 1n : 0n).max(UINT256_MAX).parse(value);
 return value;
}
export function assertFreshQuote(quotedAt:number,now=Date.now()):void {
 z.number().finite().parse(quotedAt);
 if(quotedAt>now || now-quotedAt>60_000) throw new Error('Refresh the exit quote before signing.');
}
