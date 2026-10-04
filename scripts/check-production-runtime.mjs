#!/usr/bin/env node
// Read-only production preflight. Authentication signs a fresh message only.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(pathToFileURL(resolve(root, 'app/package.json')));
const { encodeFunctionData, decodeFunctionResult, formatUnits, parseAbi } = require('viem');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const base = new URL(process.env.BASEURL || 'https://openhouse.lockgate.finance');
const expected = new URL('https://openhouse.lockgate.finance');
const checks = [];
const rpcPath = '/api/demo/rpc/421614';
const abi = parseAbi(['function availableCash() view returns (uint256)']);
const report = { target: base.origin, checkedAt: new Date().toISOString(), checks };

function assert(ok, message) { if (!ok) throw new Error(message); }
async function check(name, run) {
  try { checks.push({ name, status: 'pass', ...(await run()) }); }
  catch (error) { checks.push({ name, status: 'fail', error: String(error?.message || error) }); }
}
async function request(path, { method = 'GET', data, origin, authorization } = {}) {
  const headers = { accept: 'application/json' };
  if (data !== undefined) headers['content-type'] = 'application/json';
  if (origin) headers.origin = origin;
  if (authorization) headers.authorization = `Bearer ${authorization}`;
  const response = await fetch(new URL(path, base), {
    method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    redirect: 'manual', signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let body; try { body = JSON.parse(raw); } catch { body = undefined; }
  return { status: response.status, type: response.headers.get('content-type') || '', body, raw };
}
async function json(path, options, status = 200) {
  const result = await request(path, options);
  assert(result.status === status, `${path}: HTTP ${result.status}, expected ${status}`);
  assert(result.type.includes('application/json') && result.body && typeof result.body === 'object', `${path}: expected JSON object`);
  return result.body;
}
function errorShape(body, code) {
  assert(typeof body.error === 'string' && body.error.length > 0, 'missing error message');
  if (code) assert(body.code === code, `expected ${code}, got ${body.code}`);
}
function post(path, data, origin = base.origin) { return { method: 'POST', data, origin }; }
async function rpc(method, params = []) {
  const body = await json(rpcPath, post(rpcPath, { jsonrpc: '2.0', id: 1, method, params }));
  assert(body.jsonrpc === '2.0' && body.id === 1 && !body.error, `${method}: RPC error`);
  return body.result;
}
function cashUnits(value) {
  assert(typeof value === 'string' && /^\d+(\.\d{1,6})?$/.test(value), 'invalid six-decimal cash');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
function messageDetails(message, account) {
  assert(message.includes(`Account: ${account}`), 'challenge account mismatch');
  assert(message.includes('Network: Arbitrum Sepolia (421614)'), 'challenge chain mismatch');
  assert(message.includes(`Origin: ${base.origin}`), 'challenge canonical origin mismatch');
  assert(message.includes('does not move funds'), 'challenge purpose missing');
  const expiry = message.match(/^Expires: (.+)$/m)?.[1];
  const expiresAt = Date.parse(expiry || '');
  assert(Number.isFinite(expiresAt), 'challenge expiry missing');
  const remaining = expiresAt - Date.now();
  assert(remaining > 0 && remaining <= 5 * 60_000 + 10_000, 'challenge expiry outside five minute window');
  return expiry;
}

let configuration;
let overview;
let ephemeral;
let challenge;
await check('target', async () => {
  assert(base.origin === expected.origin && base.pathname === '/', 'BASEURL must be canonical origin');
  return { origin: base.origin };
});
if (checks.at(-1).status === 'fail') {
  report.passed = false; process.stdout.write(`${JSON.stringify(report)}\n`); process.exitCode = 1;
} else {
  await check('config', async () => {
    configuration = await json('/api/demo/config');
    assert(configuration.chainId === 421614, 'wrong chain ID');
    assert(configuration.network === 'Arbitrum Sepolia', 'wrong network label');
    assert(configuration.rpcUrl === `${base.origin}${rpcPath}`, 'config RPC is not canonical');
    assert(/^0x[0-9a-f]{40}$/i.test(configuration.asset), 'missing asset address');
    assert(/^0x[0-9a-f]{40}$/i.test(configuration.registry), 'missing registry address');
    assert(/^0x[0-9a-f]{40}$/i.test(configuration.settlement), 'missing settlement address');
    assert(configuration.vaults?.length === 5 && configuration.originators?.length === 5, 'expected five vaults and five originators');
    assert(new Set(configuration.vaults.map(v => v.address.toLowerCase())).size === 5, 'duplicate vault address');
    assert(configuration.abis?.asset?.every(item => item.name !== 'mint'), 'config exposes mint ABI');
    const deployed = JSON.parse(await readFile(resolve(root, 'scripts/demo/local/sepolia-manifest.json'), 'utf8'));
    for (const key of ['asset', 'registry', 'settlement']) {
      assert(configuration[key].toLowerCase() === deployed[key].toLowerCase(), `${key} differs from public deployment manifest`);
    }
    assert(configuration.vaults.every((v, index) => v.address.toLowerCase() === deployed.vaults[index]?.address.toLowerCase()), 'vault addresses differ from public deployment manifest');
    assert(configuration.originators.every((v, index) => v.address.toLowerCase() === deployed.originators[index]?.address.toLowerCase()), 'originator addresses differ from public deployment manifest');
    return { chainId: configuration.chainId, vaults: 5, originators: 5, asset: configuration.asset };
  });
  await check('public-chain-cash', async () => {
    assert(configuration, 'config failed');
    overview = await json('/api/demo/public');
    assert(overview.originators === 5 && overview.firms === 5, 'public count differs from 5/5');
    assert(overview.platforms?.length === 5, 'expected five platforms');
    assert(overview.environment === 'Arbitrum Sepolia', 'wrong public environment');
    assert(/^\d+$/.test(overview.blockNumber) && BigInt(overview.blockNumber) > 0n, 'missing block number');
    const chainId = await rpc('eth_chainId');
    assert(chainId === '0x66eee', `RPC returned chain ${chainId}`);
    let cash = 0n;
    for (const vault of configuration.vaults) {
      assert(/^0x[0-9a-f]{40}$/i.test(vault.address), 'invalid vault address');
      const code = await rpc('eth_getCode', [vault.address, 'latest']);
      assert(/^0x[0-9a-f]+$/i.test(code) && code !== '0x', `no code at ${vault.address}`);
      const result = await rpc('eth_call', [{ to: vault.address, data: encodeFunctionData({ abi, functionName: 'availableCash' }) }, 'latest']);
      cash += decodeFunctionResult({ abi, functionName: 'availableCash', data: result });
    }
    assert(cashUnits(overview.availableCash) === cash, 'public availableCash differs from five vault contract reads');
    return { originators: 5, firms: 5, blockNumber: overview.blockNumber, availableCash: formatUnits(cash, 6) };
  });
  await check('rpc-boundaries', async () => {
    const blocked = await json(rpcPath, post(rpcPath, { jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction', params: ['0x00'] }), 400);
    errorShape(blocked, 'INVALID_INPUT');
    const malformed = await json(rpcPath, post(rpcPath, { jsonrpc: '2.0', id: 3, method: 'eth_chainId', params: [], extra: true }), 400);
    errorShape(malformed, 'INVALID_INPUT');
    const oversized = await json(rpcPath, post(rpcPath, Array.from({ length: 51 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'eth_chainId', params: [] }))), 400);
    errorShape(oversized, 'INVALID_INPUT');
    return { blockedMethod: blocked.code, malformed: malformed.code, oversizedBatch: oversized.code };
  });
  await check('api-boundaries', async () => {
    const state = await json('/api/demo/state', {}, 401);
    errorShape(state, 'AUTH_REQUIRED');
    const unknown = await json('/api/demo/__production_smoke_unknown__', {}, 404);
    errorShape(unknown, 'NOT_FOUND');
    const wrongOrigin = await json('/api/demo/challenge', post('/api/demo/challenge', { account: '0x0000000000000000000000000000000000000001', chainId: 421614 }, 'https://wrong.example'), 403);
    errorShape(wrongOrigin, 'ORIGIN_FORBIDDEN');
    return { unauthorized: 401, unknownApi: 404, wrongOrigin: 403 };
  });
  await check('challenge-boundaries', async () => {
    ephemeral = privateKeyToAccount(generatePrivateKey());
    const input = { account: ephemeral.address, chainId: 421614 };
    const wrongChain = await json('/api/demo/challenge', post('/api/demo/challenge', { ...input, chainId: 42161 }), 409);
    errorShape(wrongChain, 'WRONG_CHAIN');
    const first = await json('/api/demo/challenge', post('/api/demo/challenge', input));
    const second = await json('/api/demo/challenge', post('/api/demo/challenge', input));
    assert(/^[0-9a-f]{32}$/.test(first.nonce) && /^[0-9a-f]{32}$/.test(second.nonce) && first.nonce !== second.nonce, 'nonce missing or repeated');
    const expiry = messageDetails(first.message, ephemeral.address);
    messageDetails(second.message, ephemeral.address);
    const mismatch = await json('/api/demo/authenticate', post('/api/demo/authenticate', { ...input, ...first, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: first.message }) }), 403);
    errorShape(mismatch, 'BAD_SIGNATURE');
    challenge = second;
    return { nonceUnique: true, expiresAt: expiry, wrongChain: 409, wrongSigner: 403 };
  });
  await check('ephemeral-signin', async () => {
    assert(ephemeral && challenge, 'challenge check failed');
    const input = { account: ephemeral.address, chainId: 421614, ...challenge };
    const signature = await ephemeral.signMessage({ message: challenge.message });
    const result = await json('/api/demo/authenticate', post('/api/demo/authenticate', { ...input, signature }));
    assert(typeof result.token === 'string' && result.token.length > 0, 'missing session');
    assert(result.state?.profile && !result.state.profile.identity, 'fresh signer unexpectedly has identity');
    assert(result.state.positions?.length === 0 && result.state.vehicles?.length === 0, 'fresh signer has private position or vehicle state');
    const state = await json('/api/demo/state', { authorization: result.token });
    assert(!state.profile?.identity && state.positions?.length === 0, 'fresh state changed unexpectedly');
    const replay = await json('/api/demo/authenticate', post('/api/demo/authenticate', { ...input, signature }), 401);
    errorShape(replay, 'CHALLENGE_INVALID');
    return { authenticated: true, identity: null, positions: 0, replay: 401 };
  });
  await check('frontend-assets', async () => {
    const html = await fetch(base, { signal: AbortSignal.timeout(20_000) });
    assert(html.status === 200 && (html.headers.get('content-type') || '').includes('text/html'), 'root HTML unavailable');
    const content = await html.text();
    const bundle = content.match(/src=["'](\/assets\/[^"']+\.js)["']/)?.[1];
    assert(bundle, 'Vite asset not found in HTML');
    const local = await readFile(resolve(root, 'app/dist/index.html'), 'utf8').catch(() => '');
    const localBundle = local.match(/src=["'](\/assets\/[^"']+\.js)["']/)?.[1];
    assert(localBundle && bundle === localBundle, 'deployed asset differs from local build');
    const asset = await fetch(new URL(bundle, base), { signal: AbortSignal.timeout(20_000) });
    assert(asset.status === 200 && (asset.headers.get('content-type') || '').includes('javascript'), 'JS asset unavailable');
    const js = await asset.text();
    assert(!/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(content + js), 'localhost URL in deployed HTML or JS');
    const spa = await fetch(new URL('/overview', base), { signal: AbortSignal.timeout(20_000) });
    assert(spa.status === 200 && (await spa.text()).includes(bundle), 'dashboard SPA route does not serve current bundle');
    return { bundle, spaRoute: '/overview', noLocalhostUrl: true };
  });
  await check('legacy-host-redirect', async () => {
    const legacy = 'https://open-house.lockgate.finance';
    for (const path of ['/', '/overview?network=421614']) {
      const response = await fetch(`${legacy}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      assert(response.status === 301, `legacy ${path}: HTTP ${response.status}, expected 301`);
      assert(response.headers.get('location') === `${base.origin}${path}`, `legacy ${path}: redirect target changed`);
    }
    return { legacy, redirects: ['/', '/overview?network=421614'], destination: base.origin };
  });
  report.passed = checks.every(item => item.status === 'pass');
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) process.exitCode = 1;
}
