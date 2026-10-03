import { describe, it, expect } from 'vitest';
import { errorMessage } from '../src/chain/client';
describe('safe provider errors', () => {
  it('recognizes plain EIP-1193 user rejection without exposing provider details', () => {
    expect(errorMessage({code:4001,message:'private wallet context'})).toBe('Wallet request rejected. Try again when you are ready.');
  });
  it('does not surface arbitrary provider objects', () => {
    expect(errorMessage({code:9000,message:'private RPC context'})).toBe('The network request failed. Try again.');
  });
});
