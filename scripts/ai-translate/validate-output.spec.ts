import { validateTranslation } from './validate-output';

describe('validateTranslation', () => {
  it('accepts clean Vietnamese', () => {
    expect(validateTranslation('Using hormones', 'thuộc về hormone')).toEqual({ ok: true });
  });

  it('rejects Chinese ideographs — the defect this pipeline created', () => {
    expect(validateTranslation('Using hormones', '用激素的。')).toEqual({
      ok: false,
      reason: 'contains_cjk',
    });
  });

  it('rejects CJK punctuation even when the words are Vietnamese', () => {
    expect(validateTranslation('A Ruthenian.', 'Một người Ruthenian。')).toEqual({
      ok: false,
      reason: 'contains_cjk',
    });
  });

  it('rejects an untranslated echo of the English', () => {
    expect(validateTranslation('Relating to X.', 'Relating to X.')).toEqual({
      ok: false,
      reason: 'equals_english',
    });
  });

  it('rejects an echo that differs only by case', () => {
    expect(validateTranslation('Relating to X.', 'relating to x.')).toEqual({
      ok: false,
      reason: 'equals_english',
    });
  });

  it('rejects translator commentary', () => {
    expect(
      validateTranslation('A dog.', 'Here is the Vietnamese translation: một con chó'),
    ).toEqual({ ok: false, reason: 'commentary' });
  });

  it('rejects runaway output', () => {
    expect(validateTranslation('Yes.', 'có '.repeat(200))).toEqual({
      ok: false,
      reason: 'length_ratio',
    });
  });

  it('rejects empty output', () => {
    expect(validateTranslation('A dog.', '   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('does not punish legitimately longer Vietnamese for short English', () => {
    // Vietnamese runs longer than English; a short headword gloss must survive.
    expect(validateTranslation('Go.', 'đi, di chuyển')).toEqual({ ok: true });
  });

  it('accepts Vietnamese containing ASCII parentheses and punctuation', () => {
    expect(
      validateTranslation('(anatomy) The heart.', '(giải phẫu) Trái tim.'),
    ).toEqual({ ok: true });
  });
});
