import { readFile } from 'node:fs/promises';
import { keccak256, type Address } from 'viem';
import { DEPLOYMENT } from '../src/chain/config';
import { personas, type SignedFork } from './signed-fork';
import { facilityAbi } from '../src/chain/facility-abi';
export async function deploySignedFacility(fork: SignedFork) {
  const artifact = JSON.parse(await readFile('../contracts/out/CreditFacility.sol/CreditFacility.json', 'utf8'));
  const book = await fork.client.readContract({ address: DEPLOYMENT.facility, abi: facilityAbi, functionName: 'receivables' });
  const init = { governor: personas.partner.address, borrower: personas.operator.address, asset: DEPLOYMENT.usdg, book, oracle: '0x0000000000000000000000000000000000000000', minPriceE8: 0n, maxOracleAge: 0n, advanceRateBps: 8000, maxLateBps: 5000, minJuniorBps: 2000, seniorAprBps: 500n, juniorAprBps: 1000n };
  const forkPoint = await fork.client.getBlock();
  const hash = await fork.wallet('operator').deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [init], gas: 8_000_000n });
  const receipt = await fork.confirmed(hash, 'local same-artifact facility fixture deployment');
  const facility = receipt.contractAddress as Address;
  fork.fixtures.push({ kind: 'Local facility fixture for immutable borrower', facility, replacedPublicAddress: DEPLOYMENT.facility, init, deploymentHash: hash, creationBytecodeHash: keccak256(artifact.bytecode.object), runtimeBytecodeHash: keccak256((await fork.client.getCode({ address: facility }))!), forkPoint: { number: forkPoint.number, hash: forkPoint.hash }, limitation: 'Does not verify original public facility borrower; same source artifact deployed locally with public disposable signing accounts.' });
  fork.mapFacility(facility);
  return facility;
}
