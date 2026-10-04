// The Cloudflare build substitutes a durable SQLite implementation of this interface.
export { mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
export async function flushDurability():Promise<void> {}
