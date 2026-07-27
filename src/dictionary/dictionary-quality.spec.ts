import {
  definitionQualityFlags,
  exampleQualityFlags,
  isUnsafeVietnamese,
} from './dictionary-quality';

describe('dictionary quality', () => {
  it('quarantines missing, CJK, and untranslated Vietnamese values', () => {
    expect(isUnsafeVietnamese(definitionQualityFlags('To possess.', null))).toBe(true);
    expect(definitionQualityFlags('To possess.', '拥有。')).toContain('vi_contains_cjk');
    expect(definitionQualityFlags('A note.', 'ghi chú【sai nguồn】')).toContain('vi_contains_cjk');
    expect(definitionQualityFlags('record', 'record')).toContain('vi_equals_en');
  });

  it('recognizes clean Vietnamese without quarantining it', () => {
    const flags = definitionQualityFlags('To possess or own something.', 'có; sở hữu');
    expect(flags).toEqual([]);
    expect(isUnsafeVietnamese(flags)).toBe(false);
  });

  it('flags raw source markup and examples unsuitable for learner cards', () => {
    expect(definitionQualityFlags('(transitive|obsolete) To hold.', 'cầm')).toContain('raw_markup');
    expect(exampleQualityFlags('x'.repeat(301), 'một ví dụ')).toContain('example_too_long');
    expect(exampleQualityFlags('<small>source fragment</small>', 'ví dụ')).toContain('raw_markup');
    expect(exampleQualityFlags('', 'ví dụ')).toContain('empty_definition');
  });
});
