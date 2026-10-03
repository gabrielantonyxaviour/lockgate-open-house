import { createWalletClient, decodeEventLog, http, parseAbi, type Address, type Abi } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { DEPLOYMENT } from '../src/chain/config';
import { creditLineAbi, tokenAbi, vaultAbi } from '../src/chain/abi';
import { factoryAbi } from '../src/chain/factory-abi';
import { FORK_RPC, personas, type Persona, type SignedFork } from './signed-fork';
const ownershipAbi = parseAbi(['function owner() view returns(address)', 'function transferOwnership(address)', 'function acceptOwnership()']);
export async function setupSignedFork(fork: SignedFork) {
  const write = async (persona: Persona, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) => {
    await fork.client.simulateContract({ account: personas[persona].address, address, abi, functionName, args });
    const hash = await fork.wallet(persona).writeContract({ address, abi, functionName, args, gas: 3_000_000n });
    return fork.confirmed(hash, `${persona} setup ${functionName}`);
  };
  for (const [address, persona, twoStep] of [
    [DEPLOYMENT.creditLine, 'operator', false], [DEPLOYMENT.factory, 'operator', false], [DEPLOYMENT.vaultA, 'partner', true],
  ] as const) {
    const owner = await fork.client.readContract({ address, abi: ownershipAbi, functionName: 'owner' });
    // Sole impersonation use: fixture ownership handover on this isolated fork.
    await fork.rpc('anvil_impersonateAccount', [owner]);
    await fork.rpc('anvil_setBalance', [owner, '0x56bc75e2d63100000']);
    const old = createWalletClient({ account: owner, chain: arbitrumSepolia, transport: http(FORK_RPC) });
    await fork.confirmed(await old.writeContract({ address, abi: ownershipAbi, functionName: 'transferOwnership', args: [personas[persona].address], gas: 3_000_000n }), 'fixture ownership handover (impersonated, excluded from signed flow claims)');
    await fork.rpc('anvil_stopImpersonatingAccount', [owner]);
    if (twoStep) await write(persona, address, ownershipAbi, 'acceptOwnership');
  }
  await write('operator', DEPLOYMENT.creditLine, creditLineAbi, 'withdrawCapital', [40_000_000n]);
  for (const persona of ['investor', 'issuer', 'partner'] as const)
    await write('operator', DEPLOYMENT.usdg, parseAbi(['function transfer(address,uint256) returns(bool)']), 'transfer', [personas[persona].address, 10_000_000n]);
  const engineCode = await fork.client.getCode({ address: personas.engine.address });
  if (engineCode && engineCode !== '0x') throw new Error('Engine fixture must have no EIP7702 delegation or contract code.');
  await fork.confirmed(await fork.wallet('operator').sendTransaction({ to: personas.engine.address, value: 10n ** 17n }), 'signed local engine gas funding');
  fork.fixtures.push({ kind: 'Engine signer', address: personas.engine.address, derivation: 'keccak256 UTF8 public fixture seed: Lockgate signed local fork disposable engine 2026-10-04. Anvil indices4 and100 have public EIP7702 code.', code: '0x' });
  const receipt = await write('operator', DEPLOYMENT.factory, factoryAbi, 'createPlatform', [1, 'Signed wallet verification', 600n, 1_000_000n, personas.issuer.address, 100_000_000n, 750]);
  const log = receipt.logs.find(item => item.address.toLowerCase() === DEPLOYMENT.factory.toLowerCase())!;
  const platform = (decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics }).args as { fund: Address }).fund;
  await write('operator', DEPLOYMENT.usdg, tokenAbi, 'approve', [DEPLOYMENT.creditLine, 5_000_000n]);
  await write('operator', DEPLOYMENT.creditLine, creditLineAbi, 'postReserve', [platform, 1_000_000n]);
  await write('partner', DEPLOYMENT.vaultA, vaultAbi, 'setProposer', [personas.engine.address]);
  await write('partner', DEPLOYMENT.vaultA, vaultAbi, 'setRouter', ['0x0000000000000000000000000000000000000000']);
  await write('partner', DEPLOYMENT.vaultA, vaultAbi, 'setOracle', ['0x0000000000000000000000000000000000000000', 0n, 0n]);
  await write('partner', DEPLOYMENT.vaultA, vaultAbi, 'setPayout', [platform, personas.investor.address]);
  return { platform, write };
}
