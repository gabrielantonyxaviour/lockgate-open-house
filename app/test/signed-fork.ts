import { expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Address, type Hash, type Hex, type TransactionSerializable } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { RPC_URL, DEPLOYMENT } from '../src/chain/config';

export const FORK_RPC = 'http://127.0.0.1:19548';
// Anvil's publicly documented disposable mnemonic, never a funded public-network wallet.
const mnemonic = 'test test test test test test test test test test test junk';
export const personas = {
  operator: mnemonicToAccount(mnemonic, { addressIndex: 0 }),
  investor: mnemonicToAccount(mnemonic, { addressIndex: 1 }),
  issuer: mnemonicToAccount(mnemonic, { addressIndex: 2 }),
  partner: mnemonicToAccount(mnemonic, { addressIndex: 3 }),
  engine: privateKeyToAccount(keccak256(stringToHex('Lockgate signed local fork disposable engine 2026-10-04'))),
};
export type Persona = keyof typeof personas;
export async function startSignedFork() {
  expect(new URL(FORK_RPC).hostname).toBe('127.0.0.1');
  const occupied = await fetch(FORK_RPC, { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false);
  if (occupied) throw new Error('19548 already occupied; refusing to share or terminate another process.');
  const process = spawn('anvil', ['--fork-url', RPC_URL, '--host', '127.0.0.1', '--port', '19548', '--chain-id', '421614', '--silent'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let startupLog = '';
  process.stderr.on('data', chunk => { startupLog = (startupLog + String(chunk)).slice(-2000); });
  const rpc = async (method: string, params: unknown[] = []) => {
    const response = await fetch(FORK_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const data = await response.json();
    if (data.error) throw new Error(`${method}: ${data.error.message}`);
    return data.result;
  };
  try {
    await expect.poll(() => { if (process.exitCode !== null) throw new Error(`Anvil exited: ${startupLog}`); return rpc('eth_chainId').catch(() => null); }, { timeout: 60000 }).toBe('0x66eee');
  } catch (error) {
    if (process.exitCode === null && process.signalCode === null) { const done = once(process, 'exit'); process.kill('SIGTERM'); await done; }
    throw error;
  }
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(FORK_RPC) });
  const wallet = (persona: Persona) => createWalletClient({ account: personas[persona], chain: arbitrumSepolia, transport: http(FORK_RPC) });
  const receipts: Record<string, unknown>[] = [];
  const signatures: Record<string, unknown>[] = [];
  const fixtures: Record<string, unknown>[] = [];
  const original = await client.getBlock();
  fixtures.push({ kind: 'Original Sepolia fork checkpoint', number: original.number, hash: original.hash, timestamp: original.timestamp });
  let facilityOverride: Address | undefined;
  const confirmed = async (hash: Hash, label: string) => {
    const receipt = await client.waitForTransactionReceipt({ hash });
    const tx = await client.getTransaction({ hash });
    receipts.push({ label, hash, from: tx.from, to: tx.to, nonce:tx.nonce, chainId:tx.chainId, r:tx.r, s:tx.s, v:tx.v, blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed, logs: receipt.logs });
    if (receipt.status !== 'success') {
      const trace = await rpc('debug_traceTransaction', [hash, {}]);
      throw new Error(`${label} receipt reverted: ${trace.returnValue}`);
    }
    return receipt;
  };
  let closing = false;
  const controls = new Map<Page, { chainId: number; rejectNext: boolean; selected?: Address }>();
  const inject = async (page: Page, persona: Persona) => {
    const account = personas[persona];
    const signer = wallet(persona);
    const state = { chainId: 421614, rejectNext: false, selected: account.address };
    controls.set(page, state);
    if (facilityOverride) await page.route('**/src/chain/config.ts*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replaceAll(DEPLOYMENT.facility, facilityOverride!);
      await route.fulfill({ response, body });
    });
    await page.route(RPC_URL, async route => {
      const body = route.request().postDataJSON();
      for (const call of Array.isArray(body) ? body : [body]) expect(call.method).not.toMatch(/send|sign/i);
      try {
        const response=await fetch(FORK_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
        await route.fulfill({status:response.status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:await response.text()});
      }
      catch (error) { if (!closing) throw error; }
    });
    await page.exposeFunction('signedForkRequest', async (method: string, params: unknown[]) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [state.selected];
      if (method === 'eth_chainId') return `0x${state.chainId.toString(16)}`;
      if (method === 'wallet_switchEthereumChain') { state.chainId = Number(BigInt((params[0] as { chainId: string }).chainId)); return null; }
      if (method === 'eth_sendTransaction') {
        if (state.rejectNext) { state.rejectNext = false; return { walletError: true, code: 4001, message: 'User rejected the request.' }; }
        if (state.chainId !== 421614) throw new Error('Wallet refuses signing on wrong chain');
        const tx = params[0] as { from: Address; to: Address; data?: Hex; value?: Hex; gas?: Hex };
        expect(tx.from.toLowerCase()).toBe(account.address.toLowerCase());
        const prepared = await signer.prepareTransactionRequest({ account, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
        const serializedTransaction = await account.signTransaction(prepared as TransactionSerializable);
        const hash = await client.sendRawTransaction({ serializedTransaction });
        await confirmed(hash, `${persona} browser locally signed raw transaction`);
        return hash;
      }
      if (method === 'eth_signTypedData_v4') {
        const typed = JSON.parse(params[1] as string);
        const signature = await account.signTypedData(typed);
        signatures.push({ persona, method, typed, signature });
        return signature;
      }
      if (/send|sign|impersonate|setBalance/.test(method)) throw new Error(`Unsupported wallet method ${method}`);
      return rpc(method, params);
    });
    await page.addInitScript(() => {
      const listeners: Record<string, ((data: unknown) => void)[]> = {};
      Object.assign(window, { ethereum: {
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          const result = await (window as unknown as { signedForkRequest: (m: string, p: unknown[]) => Promise<unknown> }).signedForkRequest(method, params);
          if (result && typeof result === 'object' && 'walletError' in result) throw result;
          return result;
        },
        on: (event: string, fn: (data: unknown) => void) => { (listeners[event] ||= []).push(fn); },
        removeListener: (event: string, fn: (data: unknown) => void) => { listeners[event] = (listeners[event] || []).filter(item => item !== fn); },
      }, walletTestEmit: (event: string, data: unknown) => { for (const fn of listeners[event] || []) fn(data); } });
    });
  };
  const setWallet = async (page: Page, next: { chainId?: number; rejectNext?: boolean; selected?: Address }) => {
    Object.assign(controls.get(page)!, next);
    await page.evaluate(next => {
      const emit = (window as unknown as { walletTestEmit: (event: string, data: unknown) => void }).walletTestEmit;
      if (next.chainId) emit('chainChanged', `0x${next.chainId.toString(16)}`);
      if (next.selected) emit('accountsChanged', [next.selected]);
    }, next);
  };
  return { rpc, client, wallet, receipts, signatures, fixtures, confirmed, inject, setWallet,
    beginClose:()=>{closing=true;},
    mapFacility: (address: Address) => { facilityOverride = address; },
    close: async () => { closing = true; if (process.exitCode === null && process.signalCode === null) { const done = once(process, 'exit'); process.kill('SIGTERM'); await done; } },
  };
}
export type SignedFork = Awaited<ReturnType<typeof startSignedFork>>;
