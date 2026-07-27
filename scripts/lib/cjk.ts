// CJK (Chinese) content must never appear in Vietnamese fields — Vietnamese is
// Latin script with combining diacritics (all codepoints < U+3000). Any match
// here is bad data. Ranges: CJK punctuation, Ext-A, Unified, Compatibility,
// and Halfwidth/Fullwidth forms.
export const CJK_REGEX = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

export function containsCjk(value: string | null | undefined): boolean {
  if (!value) return false;
  return CJK_REGEX.test(value);
}
