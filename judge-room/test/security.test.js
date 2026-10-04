import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { COOKIE, passwordHash, createSession, isAuthenticated } from '../src/auth.js';

const origin = 'https://open-house.lockgate.finance';
const password = 'test-only-high-entropy-password';
const env = { PASSWORD_SALT: 'test-only-salt-with-enough-length', SESSION_SECRET: 'test-only-session-secret-with-enough-length', LOGIN_LIMITER: { limit: async () => ({ success: true }) } };
env.PASSWORD_HASH = await passwordHash(password, env.PASSWORD_SALT);
const data = { asOf: '2026-10-04', overview: 'CONFIDENTIAL_CANARY <script>alert(1)</script>', metrics: [], sections: [{ id: 'proof', title: '<img src=x>', summary: 'Private', items: [{ title: 'Reply', body: ['<script>secret</script>'], sources: ['private/local.json'] }] }], appendices: { retained: ['client@example.invalid'] } };
const request = (path = '/judges', options = {}) => new Request(origin + path, options);
const post = (body, extra = {}) => request('/judges/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body });

test('anonymous routes and cache headers never disclose private data', async () => {
  for (const path of ['/judges', '/judges/', '/judges?download=1', '/judges/data.json', '/judges/private/evidence.json', '/judges/src/index.js', '/judgesfoo']) {
    const response = await handle(request(path), env, data);
    const body = await response.text();
    assert.equal(body.includes('CONFIDENTIAL_CANARY'), false);
    assert.equal(body.includes('client@example.invalid'), false);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  }
  assert.equal((await handle(request('/judges/data.json'), env, data)).status, 401);
});

test('invalid forms, oversized bodies, missing secrets, rate limit fail closed', async () => {
  assert.equal((await handle(post('password=wrong'), env, data)).status, 401);
  assert.equal((await handle(post('password=a&password=b'), env, data)).status, 400);
  assert.equal((await handle(post('password=a&extra=x'), env, data)).status, 400);
  assert.equal((await handle(post(`password=${'a'.repeat(3000)}`), env, data)).status, 413);
  assert.equal((await handle(post('password=a', { Origin: 'https://evil.example' }), env, data)).status, 403);
  assert.equal((await handle(request(), {}, data)).status, 503);
  const limited = await handle(post('password=a'), { ...env, LOGIN_LIMITER: { limit: async () => ({ success: false }) } }, data);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
});

test('login grants signed secure cookie and private content remains escaped', async () => {
  const response = await handle(post(new URLSearchParams({ password }).toString()), env, data);
  assert.equal(response.status, 303);
  const cookie = response.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/judges']) assert.ok(cookie.includes(flag));
  const headers = { Cookie: cookie.split(';')[0] };
  const page = await handle(request('/judges', { headers }), env, data);
  const body = await page.text();
  assert.equal(page.status, 200);
  assert.ok(body.includes('CONFIDENTIAL_CANARY'));
  assert.ok(body.includes('&lt;script&gt;'));
  assert.equal(body.includes('<script>'), false);
  const download = await handle(request('/judges/data.json', { headers }), env, data);
  assert.deepEqual(await download.json(), data);
  const logout = await handle(request('/judges/logout', { method: 'POST', headers: { Origin: origin, ...headers } }), env, data);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('tampered, expired, duplicate and cross-host cookies are rejected', async () => {
  const now = Date.now();
  const token = await createSession(env, 'open-house.lockgate.finance', now);
  const cookie = `${COOKIE}=${token}`;
  assert.equal(await isAuthenticated(request('/judges', { headers: { Cookie: cookie } }), env, now), true);
  for (const bad of [`${cookie}0`, `${cookie}; ${cookie}`, `${COOKIE}=garbage`]) assert.equal(await isAuthenticated(request('/judges', { headers: { Cookie: bad } }), env, now), false);
  assert.equal(await isAuthenticated(request('/judges', { headers: { Cookie: cookie } }), env, now + 8 * 60 * 60 * 1000 + 1000), false);
  assert.equal(await isAuthenticated(new Request('https://other.example/judges', { headers: { Cookie: cookie } }), env, now), false);
});
