import { toCsvCell, buildConflictRows, buildEchoRows } from './export-review-queues';

describe('toCsvCell', () => {
  it('guards against spreadsheet formula injection', () => {
    expect(toCsvCell('=cmd|/c calc')).toBe(`"'=cmd|/c calc"`);
    expect(toCsvCell('+1')).toBe(`"'+1"`);
    expect(toCsvCell('-2')).toBe(`"'-2"`);
    expect(toCsvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(toCsvCell('safe')).toBe('"safe"');
  });

  it('escapes embedded quotes and preserves newlines', () => {
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('renders null and undefined as empty', () => {
    expect(toCsvCell(null)).toBe('""');
    expect(toCsvCell(undefined)).toBe('""');
  });
});

describe('buildConflictRows', () => {
  it('emits one row per variant with a shared group key', () => {
    const rows = buildConflictRows(
      [{ definition_id: 7, example_en_digest: 'abc', example_ids: [1, 2], variant_count: 2 }],
      new Map([
        [1, { example_en: 'A dog.', example_vi: 'Một con chó.' }],
        [2, { example_en: 'A dog.', example_vi: 'Con chó.' }],
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].group_key).toBe(rows[1].group_key);
    expect(rows[0].group_key).toBe('7:abc');
    expect(rows.map((r) => r.example_vi)).toEqual(['Một con chó.', 'Con chó.']);
    // A reviewer needs somewhere to record the decision.
    expect(rows[0]).toHaveProperty('reviewer_decision', '');
  });

  it('matches string ids, because bigint[] arrives from the driver as strings', () => {
    // Regression: the real export produced 0 rows and skipped all 1839 ids
    // because example_ids came back as strings and the Map is keyed by number.
    const rows = buildConflictRows(
      [{
        definition_id: 7,
        example_en_digest: 'abc',
        example_ids: ['1', '2'] as unknown as number[],
        variant_count: 2,
      }],
      new Map([
        [1, { example_en: 'A dog.', example_vi: 'Một con chó.' }],
        [2, { example_en: 'A dog.', example_vi: 'Con chó.' }],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.example_id)).toEqual([1, 2]);
  });

  it('skips ids missing from the example map rather than emitting blanks', () => {
    const rows = buildConflictRows(
      [{ definition_id: 7, example_en_digest: 'abc', example_ids: [1, 99], variant_count: 2 }],
      new Map([[1, { example_en: 'A dog.', example_vi: 'Một con chó.' }]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].example_id).toBe(1);
  });
});

describe('buildEchoRows', () => {
  it('carries the classification through so reviewers can filter', () => {
    const rows = buildEchoRows([
      { table_name: 'definitions', row_id: 5, kind: 'needs_translation', english: 'A dog.', vietnamese: 'A dog.' },
      { table_name: 'definitions', row_id: 6, kind: 'symbol_only', english: "' + '", vietnamese: "' + '" },
    ]);

    expect(rows.map((r) => r.kind)).toEqual(['needs_translation', 'symbol_only']);
    expect(rows[0]).toHaveProperty('reviewer_decision', '');
    expect(rows[0].row_id).toBe(5);
  });
});
