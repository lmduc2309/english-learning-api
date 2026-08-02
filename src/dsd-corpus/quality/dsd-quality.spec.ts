import * as fs from 'fs';
import * as path from 'path';
import {
  DefinitionRecord,
  ExampleRecord,
  TranslationRecord,
  checkCorpus,
  checkDefinition,
  checkExample,
  checkTranslation,
  criticalFindings,
  inflectionsOf,
  isFormulaInjection,
  summarize,
  toCsvCell,
} from './dsd-quality';

function definition(overrides: Partial<DefinitionRecord> = {}): DefinitionRecord {
  return {
    entityId: 'd1',
    headword: 'rehearse',
    partOfSpeech: 'verb',
    definitionEn: 'To practise a performance before presenting it to an audience.',
    usageLabels: ['general'],
    ...overrides,
  };
}

function translation(overrides: Partial<TranslationRecord> = {}): TranslationRecord {
  return {
    entityId: 't1',
    headword: 'rehearse',
    definitionEn: 'To practise a performance before presenting it to an audience.',
    locale: 'vi',
    text: 'diễn tập',
    ...overrides,
  };
}

function example(overrides: Partial<ExampleRecord> = {}): ExampleRecord {
  return {
    entityId: 'x1',
    headword: 'rehearse',
    partOfSpeech: 'verb',
    exampleEn: 'The choir rehearses every Thursday evening.',
    exampleVi: 'Dàn hợp xướng diễn tập vào mỗi tối thứ Năm.',
    ...overrides,
  };
}

const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe('clean records', () => {
  it('pass with no findings at all', () => {
    expect(checkDefinition(definition())).toEqual([]);
    expect(checkTranslation(translation())).toEqual([]);
    expect(checkExample(example())).toEqual([]);
  });
});

describe('text hygiene', () => {
  it.each([
    ['empty', '   ', 'empty_content'],
    ['HTML', 'To practise <b>before</b> a performance.', 'raw_markup'],
    ['an HTML entity', 'To practise &nbsp; before a performance.', 'raw_markup'],
    ['a wiki template', 'To practise {{en-verb}} before a performance.', 'raw_markup'],
    ['a wiki link', 'To practise [[performance]] beforehand.', 'raw_markup'],
    ['a markdown link', 'To practise [this](http://x) beforehand.', 'raw_markup'],
    ['a code fence', '```To practise beforehand.```', 'raw_markup'],
    ['a control character', 'To practise before a performance.', 'control_characters'],
    ['a zero-width space', 'To practise​ before a performance.', 'invisible_characters'],
    ['a replacement character', 'To practise� before a performance.', 'encoding_damage'],
  ])('flags %s', (_label, definitionEn, rule) => {
    expect(rules(checkDefinition(definition({ definitionEn })))).toContain(rule);
  });

  it.each([
    'As an AI language model, I cannot provide a definition.',
    'Here is the definition you asked for.',
    'Sure, to practise beforehand.',
    'Translate the following into Vietnamese.',
  ])('flags prompt leakage: %s', (definitionEn) => {
    // DSD v1 admits no machine-generated content, so this is not a style
    // problem — it is evidence a prohibited step ran.
    expect(rules(checkDefinition(definition({ definitionEn })))).toContain('prompt_leakage');
  });

  it('flags a leading spreadsheet formula character', () => {
    expect(rules(checkDefinition(definition({ definitionEn: '=SUM(A1:A9) practise first.' }))))
      .toContain('formula_injection');
  });
});

describe('script contamination', () => {
  it('flags CJK in an English definition', () => {
    expect(rules(checkDefinition(definition({ definitionEn: 'To practise 練習 beforehand.' }))))
      .toContain('non_english_script');
  });

  it('flags Vietnamese in an English definition', () => {
    expect(rules(checkDefinition(definition({ definitionEn: 'To practise diễn tập beforehand.' }))))
      .toContain('vietnamese_in_english');
  });

  it('does not flag Latin-1 accents, which occur in English loanwords', () => {
    for (const definitionEn of [
      'A small café where people meet in the morning.',
      'Showing a naïve trust in other people.',
      'A résumé listing a person’s work history.',
    ]) {
      expect(rules(checkDefinition(definition({ definitionEn, headword: 'thing', partOfSpeech: 'noun' }))))
        .not.toContain('vietnamese_in_english');
    }
  });

  it('flags CJK in Vietnamese', () => {
    expect(rules(checkTranslation(translation({ text: 'diễn tập 練習' })))).toContain(
      'cjk_in_vietnamese',
    );
  });

  it('flags an unexpected script in Vietnamese', () => {
    expect(rules(checkTranslation(translation({ text: 'диễn tập' })))).toContain('unexpected_script');
  });
});

describe('translation rules', () => {
  it('flags Vietnamese identical to the English definition', () => {
    const record = translation();
    expect(rules(checkTranslation({ ...record, text: record.definitionEn }))).toContain(
      'untranslated',
    );
  });

  it('flags a translation that is just the English headword', () => {
    // The legacy corpus is full of these: a headword copied across and never
    // translated.
    expect(rules(checkTranslation(translation({ text: 'rehearse' })))).toContain('headword_echo');
  });

  it('ignores case and punctuation when comparing', () => {
    expect(rules(checkTranslation(translation({ text: 'Rehearse.' })))).toContain('headword_echo');
  });

  it('flags a non-Vietnamese locale', () => {
    expect(rules(checkTranslation(translation({ locale: 'fr' })))).toContain('locale_allowlist');
  });

  it('warns when a translation is long enough to be a definition', () => {
    const long = translation({ text: 'diễn tập '.repeat(30) });
    expect(rules(checkTranslation(long))).toContain('translation_long');
    expect(criticalFindings(checkTranslation(long))).toEqual([]);
  });
});

describe('definition rules', () => {
  it('rejects a part of speech outside the allowlist', () => {
    expect(rules(checkDefinition(definition({ partOfSpeech: 'gerundive' })))).toContain(
      'pos_allowlist',
    );
  });

  it('rejects a usage label outside the allowlist', () => {
    expect(rules(checkDefinition(definition({ usageLabels: ['vulgar-ish'] })))).toContain(
      'usage_label_allowlist',
    );
  });

  it('rejects a definition that is only the headword', () => {
    expect(rules(checkDefinition(definition({ definitionEn: 'Rehearse.' })))).toContain(
      'headword_only_definition',
    );
  });

  it('rejects a circular definition', () => {
    expect(rules(checkDefinition(definition({ definitionEn: 'To rehearse something.' })))).toContain(
      'circular_definition',
    );
  });

  it('only warns when a real definition happens to use the headword', () => {
    const findings = checkDefinition(
      definition({ definitionEn: 'To rehearse a piece of music with the other players present.' }),
    );
    expect(rules(findings)).toContain('defines_with_headword');
    expect(criticalFindings(findings)).toEqual([]);
  });

  it('catches circularity through an inflection', () => {
    expect(
      rules(checkDefinition(definition({ definitionEn: 'The act of rehearsing.' }))),
    ).toContain('circular_definition');
  });

  it('rejects a definition too short to be one', () => {
    expect(rules(checkDefinition(definition({ definitionEn: 'To go.' })))).toContain(
      'definition_too_short',
    );
  });

  it('rejects a definition past the schema limit', () => {
    const findings = checkDefinition(definition({ definitionEn: `To practise ${'x '.repeat(220)}.` }));
    expect(rules(findings)).toContain('definition_too_long');
  });

  it('warns rather than blocks on a merely long definition', () => {
    const definitionEn = `To practise a performance in a way that ${'is careful and '.repeat(16)}deliberate.`;
    const findings = checkDefinition(definition({ definitionEn }));
    expect(rules(findings)).toContain('definition_long');
    expect(criticalFindings(findings)).toEqual([]);
  });

  it('warns when a definition ends mid-clause', () => {
    expect(rules(checkDefinition(definition({ definitionEn: 'To practise a performance,' }))))
      .toContain('definition_truncated');
  });
});

describe('example rules', () => {
  it('requires the example to use the headword', () => {
    expect(
      rules(checkExample(example({ exampleEn: 'The choir met every Thursday evening.' }))),
    ).toContain('lemma_missing');
  });

  it('accepts a regular inflection without being told about it', () => {
    for (const exampleEn of [
      'They rehearse on Tuesdays.',
      'She rehearsed the speech twice.',
      'He is rehearsing his lines.',
      'The band rehearses in the garage.',
    ]) {
      expect(rules(checkExample(example({ exampleEn })))).not.toContain('lemma_missing');
    }
  });

  it('accepts an irregular form only when it has been declared', () => {
    const irregular = example({
      headword: 'go',
      exampleEn: 'She went to the market yesterday.',
      exampleVi: 'Cô ấy đã đi chợ hôm qua.',
    });
    expect(rules(checkExample(irregular))).toContain('lemma_missing');
    expect(rules(checkExample({ ...irregular, approvedInflections: ['went', 'gone'] })))
      .not.toContain('lemma_missing');
  });

  it('flags an example identical in both languages', () => {
    const same = 'The choir rehearses every Thursday.';
    expect(rules(checkExample(example({ exampleEn: same, exampleVi: same })))).toContain(
      'untranslated',
    );
  });

  it('rejects a fragment', () => {
    expect(rules(checkExample(example({ exampleEn: 'Rehearse.' })))).toContain(
      'example_too_short',
    );
  });

  it('warns about sentence form without blocking', () => {
    const findings = checkExample(example({ exampleEn: 'the choir rehearses every Thursday' }));
    expect(rules(findings)).toContain('sentence_form');
    expect(criticalFindings(findings)).toEqual([]);
  });

  it('checks both languages for hygiene', () => {
    expect(rules(checkExample(example({ exampleVi: 'Dàn hợp xướng <b>diễn tập</b>.' })))).toContain(
      'raw_markup',
    );
  });
});

describe('inflectionsOf', () => {
  it('handles a silent e', () => {
    expect(inflectionsOf('rehearse', 'verb')).toEqual(
      expect.arrayContaining(['rehearse', 'rehearses', 'rehearsed', 'rehearsing']),
    );
  });

  it('handles consonant + y', () => {
    expect(inflectionsOf('carry', 'verb')).toEqual(
      expect.arrayContaining(['carries', 'carried', 'carrying']),
    );
  });

  it('handles a sibilant plural', () => {
    expect(inflectionsOf('box', 'noun')).toEqual(expect.arrayContaining(['box', 'boxes']));
  });

  it('offers only the base form for a part of speech that does not inflect', () => {
    expect(inflectionsOf('although', 'conjunction')).toEqual(['although']);
  });
});

describe('checkCorpus', () => {
  it('flags two senses sharing a definition and part of speech', () => {
    const findings = checkCorpus({
      definitions: [definition({ entityId: 'd1' }), definition({ entityId: 'd2' })],
      examples: [],
    });
    expect(rules(findings)).toContain('duplicate_definition');
  });

  it('allows the same wording under a different part of speech', () => {
    const findings = checkCorpus({
      definitions: [
        definition({ entityId: 'd1', partOfSpeech: 'verb' }),
        definition({ entityId: 'd2', partOfSpeech: 'noun' }),
      ],
      examples: [],
    });
    expect(rules(findings)).not.toContain('duplicate_definition');
  });

  it('flags a reused example', () => {
    const findings = checkCorpus({
      definitions: [],
      examples: [example({ entityId: 'x1' }), example({ entityId: 'x2' })],
    });
    expect(rules(findings)).toContain('duplicate_example');
  });

  it('warns about a repeated opening, which reads like a filled-in template', () => {
    const definitions = Array.from({ length: 5 }, (_, i) =>
      definition({
        entityId: `d${i}`,
        headword: `thing${i}`,
        partOfSpeech: 'noun',
        definitionEn: `Of or relating to the practice of thing number ${i}.`,
      }),
    );
    const findings = checkCorpus({ definitions, examples: [] });
    expect(rules(findings)).toContain('repeated_boilerplate');
    expect(criticalFindings(findings)).toEqual([]);
  });
});

describe('export safety', () => {
  it.each(['=cmd', '+1', '-1', '@SUM', '\tx', '\rx'])('treats %j as injection', (value) => {
    expect(isFormulaInjection(value)).toBe(true);
  });

  it('neutralises the prefix and quotes the cell', () => {
    expect(toCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(toCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(toCsvCell(null)).toBe('""');
  });
});

describe('severity discipline', () => {
  it('never turns a warning into a pass by omission', () => {
    // A warning must still appear in the findings and the summary; only the
    // caller decides what blocks.
    const findings = checkDefinition(
      definition({ definitionEn: 'To rehearse a piece of music with the other players present.' }),
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(criticalFindings(findings)).toEqual([]);
    expect(summarize(findings)['warning:defines_with_headword']).toBe(1);
  });

  it('counts findings by severity and rule', () => {
    expect(summarize(checkDefinition(definition({ definitionEn: '   ' })))).toEqual({
      'critical:empty_content': 1,
    });
  });
});

describe('isolation', () => {
  it('imports nothing, so no rule can reach a legacy row', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'dsd-quality.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
  });
});
