import { describe, expect, it } from 'vitest';
import { DRAFT_KEY, emptyDraft, loadDraft, readyDraft, saveDraft } from '../src/ui/drafts';

function storage(raw: string | null = null) {
  const data = new Map<string, string>();
  if (raw !== null) data.set(DRAFT_KEY, raw);
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
const complete = { ...emptyDraft, company: 'Harbour Credit Pte Ltd', platform: 'Harbour Income',
  issuer: `0x${'a'.repeat(40)}`, limit: '1000.000001', tenor: '30', reserve: '75' };

describe('local platform draft boundary', () => {
  it('round trips an incomplete plan without pretending it is ready', () => {
    const local = storage();
    expect(saveDraft(local, emptyDraft, 2)).toBe(true);
    expect(loadDraft(local)?.fields).toEqual(emptyDraft);
    expect(readyDraft.safeParse(emptyDraft).success).toBe(false);
  });
  it('rejects corrupted, oversized, unknown-version and extra-field records', () => {
    for (const raw of ['{', 'x'.repeat(4097), JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 1, step: 0, fields: { ...emptyDraft, privateKey: 'secret' }, savedAt: 1 })]) {
      expect(loadDraft(storage(raw))).toBeNull();
    }
  });
  it('rejects malformed addresses, fractional precision and invalid economics', () => {
    expect(readyDraft.safeParse(complete).success).toBe(true);
    for (const values of [{ issuer: '0xabc' }, { limit: '1e9' }, { limit: '-1' },
      { limit: '1.0000001' }, { reserve: '1001' }, { tenor: '0' }, { tenor: '3651' }]) {
      expect(readyDraft.safeParse({ ...complete, ...values }).success).toBe(false);
    }
  });
  it('handles browser storage denial without crashing', () => {
    const denied = { getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(loadDraft(denied)).toBeNull();
    expect(saveDraft(denied, complete, 0)).toBe(false);
  });
  it('rejects an invalid navigation step and oversized input before writing', () => {
    const local = storage();
    expect(saveDraft(local, complete, 5)).toBe(false);
    expect(saveDraft(local, { ...complete, company: 'x'.repeat(121) }, 0)).toBe(false);
    expect(local.getItem(DRAFT_KEY)).toBeNull();
  });
});
