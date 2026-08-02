import {
  INVENTORY_COLUMNS,
  FORBIDDEN_COLUMNS,
  normalizeHeadword,
  validateHeaders,
  validateRow,
  planImport,
  InventoryRow,
  ExistingEntry,
} from './inventory';

function row(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    headword: 'rehearse',
    part_of_speech_expectation: 'verb',
    dsd_priority: '120',
    dsd_band: 'core',
    product_rationale: 'Common in workplace and study contexts.',
    author_contributor_id: 'DSD-A-001',
    authored_date: '2026-08-02',
    inventory_evidence_id: 'EV-INV-001',
    declaration_id: 'DSD-DECL-20260802-001',
    ...overrides,
  };
}

describe('normalizeHeadword', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeHeadword('  ice   cream ').headword).toBe('ice cream');
  });

  it('folds curly apostrophes to straight, so two spellings cannot both exist', () => {
    const curly = normalizeHeadword('o’clock');
    expect(curly.headword).toBe("o'clock");
    expect(curly.headwordNormalized).toBe("o'clock");
  });

  it('applies NFC so decomposed and composed forms converge', () => {
    const decomposed = normalizeHeadword('café');   // e + combining acute
    const composed = normalizeHeadword('café');       // é
    expect(decomposed.headword).toBe(composed.headword);
    expect(decomposed.headword.length).toBe(4);
  });

  it('preserves display casing but lowercases the normalized form', () => {
    const result = normalizeHeadword('March');
    expect(result.headword).toBe('March');
    expect(result.headwordNormalized).toBe('march');
  });

  it('is idempotent', () => {
    const once = normalizeHeadword('  O’Clock  ');
    const twice = normalizeHeadword(once.headword);
    expect(twice).toEqual(once);
  });
});

describe('validateHeaders', () => {
  it('accepts exactly the declared columns', () => {
    expect(validateHeaders([...INVENTORY_COLUMNS])).toEqual([]);
  });

  it.each(FORBIDDEN_COLUMNS)('rejects the legacy-bearing column %s', (column) => {
    const errors = validateHeaders([...INVENTORY_COLUMNS, column]);
    expect(errors.join(' ')).toMatch(new RegExp(`forbidden column '${column}'`, 'i'));
  });

  it('rejects an unknown column rather than ignoring it', () => {
    // Silently dropping a column would let content enter unnoticed.
    const errors = validateHeaders([...INVENTORY_COLUMNS, 'notes_from_wiktionary']);
    expect(errors.join(' ')).toMatch(/unknown column 'notes_from_wiktionary'/i);
  });

  it('reports a missing required column', () => {
    const errors = validateHeaders(INVENTORY_COLUMNS.filter((c) => c !== 'declaration_id'));
    expect(errors.join(' ')).toMatch(/missing required column 'declaration_id'/i);
  });
});

describe('validateRow', () => {
  it('accepts a well-formed row', () => {
    expect(validateRow(row(), 2)).toEqual([]);
  });

  it('requires a clean-room declaration', () => {
    expect(validateRow(row({ declaration_id: '' }), 2).join(' ')).toMatch(/declaration/i);
  });

  it('requires a pseudonymous author id, not a name', () => {
    expect(validateRow(row({ author_contributor_id: 'Duc Le' }), 2).join(' ')).toMatch(
      /pseudonymous/i,
    );
  });

  it('rejects a headword that is really a definition', () => {
    // The most likely way legacy content sneaks in: pasted into the wrong cell.
    const errors = validateRow(
      row({ headword: 'To practise something before performing it in public.' }),
      2,
    );
    expect(errors.join(' ')).toMatch(/headword.*too long|sentence/i);
  });

  it('rejects a headword containing sentence punctuation', () => {
    expect(validateRow(row({ headword: 'rehearse.' }), 2).join(' ')).toMatch(/punctuation/i);
  });

  it('rejects a headword containing Vietnamese, which would mean a translation', () => {
    expect(validateRow(row({ headword: 'diễn tập' }), 2).join(' ')).toMatch(
      /non-English|vietnamese/i,
    );
  });

  it('rejects an unknown part-of-speech expectation', () => {
    expect(validateRow(row({ part_of_speech_expectation: 'gerundive' }), 2).join(' ')).toMatch(
      /part of speech/i,
    );
  });

  it('requires a positive integer priority', () => {
    expect(validateRow(row({ dsd_priority: '0' }), 2).join(' ')).toMatch(/priority/i);
    expect(validateRow(row({ dsd_priority: 'high' }), 2).join(' ')).toMatch(/priority/i);
  });

  it('requires a product rationale, since inventory is a product decision', () => {
    expect(validateRow(row({ product_rationale: '' }), 2).join(' ')).toMatch(/rationale/i);
  });

  it('names the row number so a large file is diagnosable', () => {
    expect(validateRow(row({ headword: '' }), 47).join(' ')).toMatch(/row 47/i);
  });
});

describe('planImport', () => {
  const existing = (overrides: Partial<ExistingEntry> = {}): ExistingEntry => ({
    headwordNormalized: 'rehearse',
    headword: 'rehearse',
    dsdPriority: 120,
    dsdBand: 'core',
    status: 'draft',
    ...overrides,
  });

  it('inserts a headword that does not yet exist', () => {
    const plan = planImport([row()], []);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.unchanged).toHaveLength(0);
    expect(plan.rejected).toHaveLength(0);
  });

  it('is idempotent: an unchanged re-import changes nothing', () => {
    const plan = planImport([row()], [existing()]);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  it('updates a draft entry whose priority changed', () => {
    const plan = planImport([row({ dsd_priority: '55' })], [existing()]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  it.each(['approved', 'published'])(
    'rejects a change to a %s entry, requiring the amendment workflow',
    (status) => {
      const plan = planImport([row({ dsd_priority: '55' })], [existing({ status })]);
      expect(plan.toUpdate).toHaveLength(0);
      expect(plan.rejected.join(' ')).toMatch(/amendment workflow/i);
    },
  );

  it('leaves an unchanged approved entry alone rather than rejecting it', () => {
    // Re-importing the same file must stay idempotent even after approval.
    const plan = planImport([row()], [existing({ status: 'approved' })]);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  it('rejects a file containing the same headword twice', () => {
    const plan = planImport([row(), row({ headword: 'Rehearse' })], []);
    expect(plan.rejected.join(' ')).toMatch(/duplicate headword/i);
  });
});
