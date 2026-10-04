/** Splits at measured page boundaries; concatenating the result recovers every original byte. */
export function paginateAgreement(text: string, fits: (text: string) => boolean): string[] {
  const pages: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let low = 1, high = text.length - offset, size = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(text.slice(offset, offset + middle))) { size = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (!size) throw new Error('Document page is too small to display text.');
    if (offset + size < text.length) {
      const candidate = text.slice(offset, offset + size);
      const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
      if (boundary > size / 2) size = boundary + 1;
      // Never split a UTF-16 surrogate pair between visible pages.
      const last = text.charCodeAt(offset + size - 1);
      if (last >= 0xd800 && last <= 0xdbff && size > 1) size--;
    }
    pages.push(text.slice(offset, offset + size));
    offset += size;
  }
  return pages.length ? pages : [''];
}
