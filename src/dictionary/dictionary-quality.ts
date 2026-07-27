export type DictionaryQualityFlag =
  | 'missing_vi'
  | 'vi_contains_cjk'
  | 'vi_equals_en'
  | 'raw_markup'
  | 'empty_definition'
  | 'example_too_long';

// Keep aligned with ExpandDictionaryCjkQuality and clean-cjk.ts so new raw
// imports receive the same quarantine decision as the migrated corpus.
const CJK_RE = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;
const RAW_MARKUP_RE = /\([^)]*\|[^)]*\)|thumb\||<[^>]+>|&(?:nbsp|emsp|ensp|lt|gt|amp|quot);|\{\{|\}\}/i;

export function definitionQualityFlags(english: string, vietnamese: string | null | undefined): DictionaryQualityFlag[] {
  const flags: DictionaryQualityFlag[] = [];
  const en = english?.trim() || '';
  const vi = vietnamese?.trim() || '';
  if (!en || /^(?:\([^)]*\)\s*)?\.?$/.test(en)) flags.push('empty_definition');
  if (!vi) flags.push('missing_vi');
  if (vi && CJK_RE.test(vi)) flags.push('vi_contains_cjk');
  if (vi && en.localeCompare(vi, undefined, { sensitivity: 'accent' }) === 0) flags.push('vi_equals_en');
  if (RAW_MARKUP_RE.test(en)) flags.push('raw_markup');
  return flags;
}

export function exampleQualityFlags(english: string, vietnamese: string | null | undefined): DictionaryQualityFlag[] {
  const flags: DictionaryQualityFlag[] = definitionQualityFlags(english, vietnamese)
    .filter((flag) => flag !== 'raw_markup');
  if ((english?.length || 0) > 300) flags.push('example_too_long');
  if (RAW_MARKUP_RE.test(english || '')) flags.push('raw_markup');
  return flags;
}

export function isUnsafeVietnamese(flags: readonly string[]): boolean {
  return flags.some((flag) => flag === 'missing_vi' || flag === 'vi_contains_cjk' || flag === 'vi_equals_en');
}
