/**
 * Rejects model output before it reaches the database.
 *
 * The pipeline previously accepted any non-empty string. Combined with a
 * free-tier model that drifts into Chinese, that is the most plausible origin
 * of the corpus's CJK-contaminated Vietnamese. Nothing here is cosmetic: a
 * translation that would immediately be flagged by dictionary-quality.ts must
 * never be persisted in the first place.
 *
 * Kept deliberately aligned with CJK_RE in src/dictionary/dictionary-quality.ts.
 */

export type RejectionReason =
  | 'empty'
  | 'contains_cjk'
  | 'equals_english'
  | 'commentary'
  | 'length_ratio';

export interface ValidationResult {
  ok: boolean;
  reason?: RejectionReason;
}

// U+3000-303F CJK punctuation, U+3400-4DBF extension A, U+4E00-9FFF unified,
// U+F900-FAFF compatibility, U+FF00-FFEF halfwidth/fullwidth forms.
const CJK_RE = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

const COMMENTARY_RE =
  /\b(here (?:is|are)|translation|translated|as an ai|i cannot|note:|sure[,!]|certainly[,!])\b/i;

// Vietnamese runs longer than English, but not unboundedly. The floor stops a
// short gloss ("Go." -> "đi, di chuyển") tripping the ratio.
const MAX_LENGTH_RATIO = 4;
const MIN_LENGTH_FOR_RATIO_CHECK = 40;

export function validateTranslation(english: string, vietnamese: string): ValidationResult {
  const en = (english || '').trim();
  const vi = (vietnamese || '').trim();

  if (!vi) return { ok: false, reason: 'empty' };
  if (CJK_RE.test(vi)) return { ok: false, reason: 'contains_cjk' };

  // sensitivity 'accent' ignores case but keeps accents significant, matching
  // definitionQualityFlags' vi_equals_en check.
  if (en && en.localeCompare(vi, undefined, { sensitivity: 'accent' }) === 0) {
    return { ok: false, reason: 'equals_english' };
  }

  if (COMMENTARY_RE.test(vi)) return { ok: false, reason: 'commentary' };

  if (
    vi.length >= MIN_LENGTH_FOR_RATIO_CHECK &&
    en.length > 0 &&
    vi.length > en.length * MAX_LENGTH_RATIO
  ) {
    return { ok: false, reason: 'length_ratio' };
  }

  return { ok: true };
}
