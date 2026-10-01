/** Kasu UserRequestIds.sol: withdrawal ids sit at or above 2^95 in the high 96 bits. */
export const WITHDRAWAL_ID_OFFSET = 2n ** 95n;

export function isDepositNft(nftId: bigint): boolean {
  return (nftId >> 160n) < WITHDRAWAL_ID_OFFSET;
}

export function withdrawalId(tranche: bigint, sequence: bigint): bigint {
  return (tranche & ((1n << 160n) - 1n)) | ((sequence + WITHDRAWAL_ID_OFFSET) << 160n);
}
