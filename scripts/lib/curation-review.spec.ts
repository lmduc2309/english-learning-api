import {
  CURATION_REVIEW_COLUMNS,
  renderCurationReviewWorksheet,
} from './curation-review';

describe('curation review worksheet', () => {
  it('exports source evidence and blank human decision columns with safe CSV escaping', () => {
    const output = renderCurationReviewWorksheet([{
      word: 'say',
      learner_rank: 30,
      sense_order: 1,
      sense_key: 'oewn:oewn-say__2.32.00..',
      part_of_speech: 'verb',
      definition_en: 'To express something in words.',
      definition_vi: 'nói, diễn đạt bằng lời.',
      examples: [{ en: 'She said, "Hello."', vi: 'Cô ấy nói: "Xin chào."' }],
      definition_source: 'Open English WordNet',
      definition_source_version: '2025',
      definition_source_artifact_sha256: 'a'.repeat(64),
      cefr_level: 'A2',
      cefr_source: 'licensed level source',
      cefr_source_version: '1',
      cefr_basis: 'sense-level evidence',
      pronunciations: [{
        accent: 'US',
        ipa: 'seɪ',
        review_status: 'draft',
        source: 'Open English WordNet',
        source_license: 'CC BY 4.0',
      }],
      status: 'draft',
      review_notes: 'Needs human review.',
    }]);

    const lines = output.trimEnd().split('\n');
    expect(lines[0]).toBe(CURATION_REVIEW_COLUMNS.join(','));
    expect(output).toContain('"nói, diễn đạt bằng lời."');
    expect(output).toContain('"1. She said, ""Hello."""');
    expect(output).toContain('US: /seɪ/ [draft; Open English WordNet; CC BY 4.0]');
    expect(output).toContain(',A2,licensed level source,1,sense-level evidence,');
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith(',,,,,,,,,')).toBe(true);
  });
});
