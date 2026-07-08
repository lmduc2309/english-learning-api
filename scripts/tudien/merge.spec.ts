import { planDefinitionUpdates, planExampleUpdates, normalizeEn, DbDefinition } from './merge';
import { ParsedEntry } from './parse-entry';

const entry = (posBlocks: ParsedEntry['posBlocks']): ParsedEntry => ({ headword: 'x', posBlocks });

describe('normalizeEn', () => {
  it('lowercases, collapses whitespace, strips trailing punctuation', () => {
    expect(normalizeEn('The  House.')).toBe('the house');
  });
});

describe('planDefinitionUpdates', () => {
  it('assigns senses of a POS block to same-POS definitions by order', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null, examples: [] },
      { id: 2, partOfSpeech: 'noun', definitionOrder: 2, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['nghĩa 1', 'nghĩa 2'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 1, definitionVi: 'nghĩa 1' },
      { definitionId: 2, definitionVi: 'nghĩa 2' },
    ]);
  });

  it('joins surplus senses onto the last matching definition', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['a', 'b', 'c'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 1, definitionVi: 'a; b; c' },
    ]);
  });

  it('falls back to the primary definition when no POS matches', () => {
    const defs: DbDefinition[] = [
      { id: 5, partOfSpeech: 'verb', definitionOrder: 2, definitionVi: null, examples: [] },
      { id: 4, partOfSpeech: 'verb', definitionOrder: 1, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['chỉ có danh từ'], examples: [] }]);
    // primary = lowest definitionOrder = id 4
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 4, definitionVi: 'chỉ có danh từ' },
    ]);
  });

  it('fill-only skips definitions that already have a Vietnamese value', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: 'đã có', examples: [] },
      { id: 2, partOfSpeech: 'noun', definitionOrder: 2, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['x', 'y'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: true })).toEqual([
      { definitionId: 2, definitionVi: 'y' },
    ]);
  });

  it('overwrites existing values by default', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: 'cũ', examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['mới'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 1, definitionVi: 'mới' },
    ]);
  });

  it('returns nothing when the word has no definitions', () => {
    const e = entry([{ vnPos: 'danh từ', senses: ['x'], examples: [] }]);
    expect(planDefinitionUpdates([], e, { fillOnly: false })).toEqual([]);
  });
});

describe('planExampleUpdates', () => {
  it('sets example_vi by normalized English match', () => {
    const defs: DbDefinition[] = [
      {
        id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null,
        examples: [
          { id: 11, exampleEn: 'The house.', exampleVi: null },
          { id: 12, exampleEn: 'unmatched', exampleVi: null },
        ],
      },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: [], examples: [{ en: 'the house', vi: 'cái nhà' }] }]);
    expect(planExampleUpdates(defs, e, { fillOnly: false })).toEqual([
      { exampleId: 11, exampleVi: 'cái nhà' },
    ]);
  });

  it('fill-only skips examples that already have a Vietnamese value', () => {
    const defs: DbDefinition[] = [
      {
        id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null,
        examples: [{ id: 11, exampleEn: 'the cat', exampleVi: 'đã dịch' }],
      },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: [], examples: [{ en: 'the cat', vi: 'con mèo' }] }]);
    expect(planExampleUpdates(defs, e, { fillOnly: true })).toEqual([]);
  });
});
