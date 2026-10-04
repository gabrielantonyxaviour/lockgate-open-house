export const COOKIE = '__Secure-lockgate_judges';
const encoder = new TextEncoder();
const lifetime = 8 * 60 * 60;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/.{2}/g) ?? [], v => parseInt(v, 16));

export async function passwordHash(password, salt) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}\0${password}`)));
}

export async function acceptsPassword(password, env) {
  const actual = await passwordHash(password, env.PASSWORD_SALT);
  if (!/^[a-f0-9]{64}$/.test(env.PASSWORD_HASH)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= actual.charCodeAt(i) ^ env.PASSWORD_HASH.charCodeAt(i);
  return difference === 0;
}

async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSession(env, hostname, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + lifetime;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${expiry}.${nonce}`;
  const mac = hex(await crypto.subtle.sign('HMAC', await key(env.SESSION_SECRET), encoder.encode(`${body}.${hostname}`)));
  return `${body}.${mac}`;
}

export async function isAuthenticated(request, env, now = Date.now()) {
  const cookies = (request.headers.get('Cookie') ?? '').split(';').map(x => x.trim());
  const matches = cookies.filter(x => x.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return false;
  const token = matches[0].slice(COOKIE.length + 1);
  const matched = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!matched) return false;
  const seconds = Math.floor(now / 1000);
  const expiry = Number(matched[1]);
  if (expiry <= seconds || expiry > seconds + lifetime + 60) return false;
  return crypto.subtle.verify('HMAC', await key(env.SESSION_SECRET), unhex(matched[3]), encoder.encode(`${matched[1]}.${matched[2]}.${new URL(request.url).hostname}`));
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/judges; Max-Age=${lifetime}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/judges; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
