import * as fs from 'fs';
import * as path from 'path';
import {
  DsdEntryAggregate,
  DsdQueryService,
  completenessProblems,
} from './dsd-query.service';

/** A complete published entry, as the serving views would return it. */
function aggregate(overrides: Partial<DsdEntryAggregate> = {}): DsdEntryAggregate {
  return {
    entry: {
      id: '11111111-1111-1111-1111-111111111111',
      headword: 'rehearse',
      headwordNormalized: 'rehearse',
      language: 'en',
      updatedAt: new Date('2026-08-03T09:00:00.000Z'),
    },
    senses: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        senseOrder: 1,
        partOfSpeech: 'verb',
        definitionEn: 'To practise a performance before presenting it.',
        usageLabels: ['general'],
        translations: [
          { id: '33333333-3333-3333-3333-333333333333', locale: 'vi', text: 'diễn tập' },
        ],
        examples: [
          {
            id: '44444444-4444-4444-4444-444444444444',
            exampleOrder: 1,
            exampleEn: 'The choir rehearses every Thursday.',
            exampleVi: 'Dàn hợp xướng diễn tập vào mỗi thứ Năm.',
          },
        ],
      },
    ],
    pronunciations: [
      {
        id: '55555555-5555-5555-5555-555555555555',
        accent: 'en-US',
        ipa: 'rɪˈhɜːrs',
        priority: 1,
        audio: [
          {
            storageKey: `dsd/audio/en-aria/${'a'.repeat(64)}.mp3`,
            mediaType: 'audio/mpeg',
            format: 'mp3',
            durationMs: 900,
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** A fake data source that records the SQL it was asked to run. */
function fakeDataSource(responses: unknown[][]) {
  const executed: string[] = [];
  let call = 0;
  return {
    executed,
    dataSource: {
      query: jest.fn(async (sql: string) => {
        executed.push(sql);
        return responses[call++] ?? [];
      }),
    } as any,
  };
}

describe('completenessProblems', () => {
  it('accepts a complete entry', () => {
    expect(completenessProblems(aggregate())).toEqual([]);
  });

  it('rejects an entry with no published sense', () => {
    expect(completenessProblems(aggregate({ senses: [] })).map((p) => p.field)).toContain('senses');
  });

  it('rejects a sense with no Vietnamese', () => {
    // A dictionary showing an English definition with no translation is not the
    // product.
    const incomplete = aggregate();
    incomplete.senses[0].translations = [];
    expect(completenessProblems(incomplete).map((p) => p.field)).toContain('translation');
  });

  it('rejects a sense whose only translation is another locale', () => {
    const incomplete = aggregate();
    incomplete.senses[0].translations = [{ id: 'x', locale: 'fr', text: 'répéter' }];
    expect(completenessProblems(incomplete).map((p) => p.field)).toContain('translation');
  });

  it('rejects a sense with no example', () => {
    const incomplete = aggregate();
    incomplete.senses[0].examples = [];
    expect(completenessProblems(incomplete).map((p) => p.field)).toContain('examples');
  });

  it('rejects an entry with no IPA', () => {
    expect(completenessProblems(aggregate({ pronunciations: [] })).map((p) => p.field)).toContain(
      'ipa',
    );
  });

  it('reports every problem rather than the first', () => {
    const incomplete = aggregate({ pronunciations: [] });
    incomplete.senses[0].translations = [];
    incomplete.senses[0].examples = [];
    expect(completenessProblems(incomplete)).toHaveLength(3);
  });

  it('names the sense a problem belongs to', () => {
    const incomplete = aggregate();
    incomplete.senses[0].examples = [];
    expect(completenessProblems(incomplete)[0].detail).toMatch(/sense 1/);
  });
});

describe('DsdQueryService with no connection', () => {
  const service = new DsdQueryService(null);

  it('reports itself unavailable', () => {
    expect(service.available).toBe(false);
  });

  it('returns null rather than throwing, so the caller can 404', () => {
    // The off channel intentionally has no connection. That is not an error.
    return expect(service.findEntry('rehearse')).resolves.toBeNull();
  });

  it('returns no search results', () => {
    return expect(service.search('reh')).resolves.toEqual([]);
  });
});

describe('DsdQueryService queries', () => {
  it('resolves a headword case-insensitively', async () => {
    const { dataSource, executed } = fakeDataSource([[aggregate().entry], [], []]);
    await new DsdQueryService(dataSource).findEntry('REHEARSE');
    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [null, 'rehearse']);
    expect(executed[0]).toMatch(/dsd_serving_entries/);
  });

  it('resolves a DSD UUID as an id, not as a headword', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const { dataSource } = fakeDataSource([[aggregate().entry], [], []]);
    await new DsdQueryService(dataSource).findEntry(id);
    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [id, null]);
  });

  it('returns null for an unknown headword without querying further', async () => {
    const { dataSource, executed } = fakeDataSource([[]]);
    expect(await new DsdQueryService(dataSource).findEntry('nope')).toBeNull();
    expect(executed).toHaveLength(1);
  });

  it('serves a complete entry', async () => {
    const full = aggregate();
    const { dataSource } = fakeDataSource([[full.entry], full.senses, full.pronunciations]);
    const result = await new DsdQueryService(dataSource).findCompleteEntry('rehearse');
    expect(result?.entry.headword).toBe('rehearse');
  });

  it('refuses a published but incomplete entry', async () => {
    // Serving a partial entry would also make the corpus look larger than it is.
    const full = aggregate();
    const { dataSource } = fakeDataSource([[full.entry], full.senses, []]);
    expect(await new DsdQueryService(dataSource).findCompleteEntry('rehearse')).toBeNull();
  });

  it('clamps the search limit', async () => {
    const { dataSource } = fakeDataSource([[]]);
    const service = new DsdQueryService(dataSource);
    await service.search('reh', 5000);
    expect(dataSource.query).toHaveBeenLastCalledWith(expect.any(String), ['reh', 100]);
    await service.search('reh', 0);
    expect(dataSource.query).toHaveBeenLastCalledWith(expect.any(String), ['reh', 1]);
  });

  it('does not query at all for an empty search', async () => {
    const { dataSource } = fakeDataSource([[]]);
    expect(await new DsdQueryService(dataSource).search('   ')).toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});

describe('what the service can reach', () => {
  const code = fs
    .readFileSync(path.resolve(__dirname, 'dsd-query.service.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('queries serving views only, never a base table', () => {
    // dsd_app is revoked from every base table, so a query naming one would fail
    // with a permission error. This catches it at review time instead.
    const relations = [...code.matchAll(/FROM\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(relations.length).toBeGreaterThan(0);
    for (const relation of relations) {
      expect(relation).toMatch(/^dsd_serving_|^dsd_servable_audio$/);
    }
  });

  it('names no compliance, provenance or candidate table', () => {
    for (const table of [
      'dsd_provenance_events',
      'dsd_similarity_results',
      'dsd_ipa_candidates',
      'dsd_audio_assets',
    ]) {
      expect(code).not.toContain(table);
    }
  });

  it('has no legacy connection to fall back to', () => {
    const modules = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const module of modules) {
      expect(module).toMatch(/^@nestjs\/common$|^typeorm$|^\.\/dsd-corpus\.module$/);
    }
  });

  it('generates nothing', () => {
    expect(code).not.toMatch(/llm|openai|openrouter|generate|translate\(/i);
  });

  it('issues no mutating statement', () => {
    expect(code).not.toMatch(/INSERT INTO|UPDATE\s|DELETE FROM/);
  });
});
