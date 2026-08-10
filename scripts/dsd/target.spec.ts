import {
  TARGET_EVIDENCE_ID,
  TARGET_ID,
  TARGET_UNIQUE_ENTRIES,
  buildTargetStatus,
  validateTargetDocument,
} from './target';

const valid = () => ({
  $schema: '../schemas/corpus-target.schema.json',
  target_id: TARGET_ID,
  language: 'en',
  unique_normalized_entries: TARGET_UNIQUE_ENTRIES,
  evidence_id: TARGET_EVIDENCE_ID,
  legacy_inventory_used: false,
});

describe('DSD corpus target contract', () => {
  it('accepts only the fixed aggregate target', () => {
    expect(validateTargetDocument(valid())).toEqual([]);
  });

  it.each(['headwords', 'word_id', 'rank', 'definition_en', 'source_hash', 'inventory'])(
    'rejects legacy-bearing field %s',
    (field) => {
      expect(validateTargetDocument({ ...valid(), [field]: ['legacy'] }).join(' '))
        .toContain(`forbidden field '${field}'`);
    },
  );

  it('rejects count or evidence drift', () => {
    expect(validateTargetDocument({ ...valid(), unique_normalized_entries: 475_152 }))
      .toContain(`unique_normalized_entries must be ${TARGET_UNIQUE_ENTRIES}`);
    expect(validateTargetDocument({ ...valid(), evidence_id: 'something-else' }))
      .toContain(`evidence_id must be '${TARGET_EVIDENCE_ID}'`);
  });

  it('reports exact deficit without treating child completion as inventory', () => {
    const status = buildTargetStatus(valid(), {
      inventory: '50',
      text_complete: '40',
      ipa_complete: '30',
      audio_complete: '20',
      release_eligible: '10',
      published: '0',
    });
    expect(status).toEqual({
      target: 475_153,
      inventory: 50,
      textComplete: 40,
      ipaComplete: 30,
      audioComplete: 20,
      releaseEligible: 10,
      published: 0,
      deficit: 475_103,
      overTarget: false,
    });
  });

  it('flags an over-target database rather than suggesting deletion', () => {
    expect(buildTargetStatus(valid(), { inventory: 475_154 }).overTarget).toBe(true);
  });
});
