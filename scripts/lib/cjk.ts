// CJK (Chinese) content must never appear in Vietnamese fields — Vietnamese is
// Latin script with combining diacritics (all codepoints < U+3000). Any match
// here is bad data. Ranges: CJK punctuation, Ext-A, Unified, Compatibility,
// and Halfwidth/Fullwidth forms.
export const CJK_REGEX = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

export function containsCjk(value: string | null | undefined): boolean {
  if (!value) return false;
  return CJK_REGEX.test(value);
}
