import { describe, expect, it } from 'vitest';
import { paginateAgreement } from '../src/demo/agreement-pages';
describe('agreement pagination preserves canonical text', () => {
  it('keeps whitespace, line endings, long tokens and unicode across every page', () => {
    const text = 'FIRST\r\n\r\n' + 'Paragraph with — Unicode 東京. '.repeat(30) + 'x'.repeat(220) + '\n  Final line.\n';
    const pages = paginateAgreement(text, value => value.length <= 73);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(text);
    expect(pages.every(value => value.length <= 73)).toBe(true);
  });
  it('reports a page too small to render even one character', () => {
    expect(() => paginateAgreement('Cannot fit', () => false)).toThrow('too small');
  });
});
