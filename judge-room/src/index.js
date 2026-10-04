import { z } from 'zod';
import { acceptsPassword, clearCookie, createSession, isAuthenticated, sessionCookie } from './auth.js';
import { loginPage, dossierPage } from './views.js';
import evidence from '../private/evidence.json' with { type: 'json' };

const credentials = z.object({ password: z.string().min(1).max(128) }).strict();
const secrets = z.object({ PASSWORD_HASH: z.string().regex(/^[a-f0-9]{64}$/), PASSWORD_SALT: z.string().min(24), SESSION_SECRET: z.string().min(32) });
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'Vary': 'Cookie',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function reply(body, status = 200, extras = {}) {
  return new Response(body, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', ...extras } });
}

const problem = (status, error, code) => reply(JSON.stringify({ error, code }), status, { 'Content-Type': 'application/json; charset=utf-8' });
const redirect = cookie => reply(null, 303, { Location: '/judges', 'Set-Cookie': cookie });

async function boundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(joined);
}

export async function handle(request, env, data = evidence) {
  const url = new URL(request.url);
  if (url.pathname !== '/judges' && !url.pathname.startsWith('/judges/')) return problem(404, 'Page not found', 'NOT_FOUND');
  if (!secrets.safeParse(env).success || !env.LOGIN_LIMITER?.limit) return problem(503, 'Review room temporarily unavailable', 'UNAVAILABLE');
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return problem(403, 'Request not accepted', 'ORIGIN_MISMATCH');
    if (url.pathname === '/judges/logout') return redirect(clearCookie());
    if (url.pathname !== '/judges/login') return problem(404, 'Page not found', 'NOT_FOUND');
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return problem(415, 'Use the password form', 'INVALID_CONTENT_TYPE');
    const limited = await env.LOGIN_LIMITER.limit({ key: `login:${request.headers.get('CF-Connecting-IP') ?? 'local'}` });
    if (!limited.success) return reply(loginPage('Too many attempts. Please try again in a minute.'), 429, { 'Retry-After': '60' });
    let form;
    try { form = new URLSearchParams(await boundedBody(request)); }
    catch { return problem(413, 'Form is too large', 'BODY_TOO_LARGE'); }
    if (form.getAll('password').length !== 1) return problem(400, 'Enter one password', 'INVALID_INPUT');
    const parsed = credentials.safeParse(Object.fromEntries(form));
    if (!parsed.success) return problem(400, 'Enter a valid password', 'INVALID_INPUT');
    if (!await acceptsPassword(parsed.data.password, env)) return reply(loginPage('That password did not match. Try again.'), 401);
    return redirect(sessionCookie(await createSession(env, url.hostname)));
  }
  if (!['GET', 'HEAD'].includes(request.method)) return problem(405, 'Method not supported', 'METHOD_NOT_ALLOWED');
  if (!['/judges', '/judges/', '/judges/data.json'].includes(url.pathname)) return problem(404, 'Page not found', 'NOT_FOUND');
  if (!await isAuthenticated(request, env)) {
    if (url.pathname === '/judges/data.json') return problem(401, 'Password required', 'UNAUTHENTICATED');
    return reply(request.method === 'HEAD' ? null : loginPage());
  }
  if (url.pathname === '/judges/data.json') return reply(request.method === 'HEAD' ? null : JSON.stringify(data), 200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="lockgate-private-evidence.json"' });
  return reply(request.method === 'HEAD' ? null : dossierPage(data));
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return problem(503, 'Review room temporarily unavailable', 'UNAVAILABLE'); }
  },
};
