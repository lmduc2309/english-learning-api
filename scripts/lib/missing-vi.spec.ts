import { isMissingVi, missingViSql, blankViSql } from './missing-vi';

describe('isMissingVi', () => {
  it('treats null, undefined, empty, and whitespace-only as missing', () => {
    expect(isMissingVi(null)).toBe(true);
    expect(isMissingVi(undefined)).toBe(true);
    expect(isMissingVi('')).toBe(true);
    expect(isMissingVi('   ')).toBe(true);
    expect(isMissingVi('\t\n')).toBe(true);
  });

  it('treats real Vietnamese / English text as present', () => {
    expect(isMissingVi('sông A-ma-zôn (Nam-Mỹ)')).toBe(false);
    expect(isMissingVi('cái tụ điện')).toBe(false);
    expect(isMissingVi('a fish')).toBe(false);
  });
});

describe('SQL fragment builders', () => {
  it('missingViSql matches NULL or blank', () => {
    expect(missingViSql('definition_vi')).toBe(
      "(definition_vi IS NULL OR btrim(definition_vi) = '')",
    );
  });

  it('blankViSql matches non-NULL blank only', () => {
    expect(blankViSql('example_vi')).toBe(
      "(example_vi IS NOT NULL AND btrim(example_vi) = '')",
    );
  });
});
