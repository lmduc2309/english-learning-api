import { DsdEntryAggregate } from './dsd-query.service';
import {
  FORBIDDEN_RESPONSE_FIELDS,
  audioUrl,
  presentEntry,
  presentSearchHits,
} from './dsd-presenter';

const OPTIONS = {
  releaseId: 'DSD-REL-V1-5000-a1b2c3d4',
  audioBaseUrl: 'https://cdn.dsdtech.site/audio',
};

/**
 * A row set carrying every internal field the base tables have.
 *
 * The extra properties are not realistic — the serving views omit them — but a
 * presenter that copies its input would pass a clean fixture and fail this one.
 */
function aggregate(): DsdEntryAggregate & Record<string, unknown> {
  return {
    entry: {
      id: '11111111-1111-1111-1111-111111111111',
      headword: 'rehearse',
      headwordNormalized: 'rehearse',
      language: 'en',
      updatedAt: new Date('2026-08-03T09:00:00.000Z'),
      status: 'published',
      authored_by: 'DSD-A-001',
      batch_id: 'B-001',
    } as any,
    senses: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        senseOrder: 1,
        partOfSpeech: 'verb',
        definitionEn: 'To practise a performance before presenting it.',
        usageLabels: ['general'],
        translations: [{ id: 't1', locale: 'vi', text: 'diễn tập' }],
        examples: [
          { id: 'x1', exampleOrder: 1, exampleEn: 'They rehearse on Tuesdays.', exampleVi: 'Họ diễn tập vào thứ Ba.' },
        ],
        relations: [
          {
            relationType: 'synonym',
            relatedSenseId: '66666666-6666-6666-6666-666666666666',
            relatedHeadword: 'practise',
          },
        ],
        content_sha256: 'a'.repeat(64),
        reviewed_by: 'DSD-R-001',
        source_id: 'dsd-english-original',
      } as any,
    ],
    pronunciations: [
      {
        id: '55555555-5555-5555-5555-555555555555',
        accent: 'en-US',
        ipa: 'rɪˈhɜːrs',
        priority: 1,
        audio: [
          { storageKey: `dsd/audio/en-aria/${'a'.repeat(64)}.wav`, mediaType: 'audio/wav', format: 'wav', durationMs: 900 },
          { storageKey: `dsd/audio/en-aria/${'b'.repeat(64)}.mp3`, mediaType: 'audio/mpeg', format: 'mp3', durationMs: 900 },
        ],
        review_status: 'accepted',
      } as any,
    ],
  };
}

describe('presentEntry', () => {
  it('uses the DSD UUID as content identity', () => {
    const presented = presentEntry(aggregate(), OPTIONS);
    expect(presented.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(presented.definitions[0].id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('keeps the field names clients already use', () => {
    const presented = presentEntry(aggregate(), OPTIONS);
    expect(Object.keys(presented.definitions[0]).sort()).toEqual([
      'definition_en',
      'definition_vi',
      'examples',
      'id',
      'part_of_speech',
      'relations',
      'usage_labels',
    ]);
    expect(Object.keys(presented).sort()).toEqual([
      'corpus_release_id',
      'data_source',
      'definitions',
      'id',
      'pronunciations',
      'updated_at',
      'word',
    ]);
    expect(presented.word).toBe('rehearse');
    expect(presented.data_source).toBe('dsd');
  });

  it('pairs each definition with its Vietnamese and examples', () => {
    const definition = presentEntry(aggregate(), OPTIONS).definitions[0];
    expect(definition.definition_en).toMatch(/To practise/);
    expect(definition.definition_vi).toBe('diễn tập');
    expect(definition.examples).toEqual([
      { en: 'They rehearse on Tuesdays.', vi: 'Họ diễn tập vào thứ Ba.' },
    ]);
  });

  it('stamps the release id, so a cached body names its corpus', () => {
    expect(presentEntry(aggregate(), OPTIONS).corpus_release_id).toBe('DSD-REL-V1-5000-a1b2c3d4');
  });

  it.each(FORBIDDEN_RESPONSE_FIELDS)('never emits %s', (field) => {
    // The fixture carries these deliberately; a presenter that spread its input
    // would leak them.
    const serialized = JSON.stringify(presentEntry(aggregate(), OPTIONS));
    expect(serialized).not.toContain(`"${field}"`);
  });

  it('leaks no contributor identity or hash in any value either', () => {
    const serialized = JSON.stringify(presentEntry(aggregate(), OPTIONS));
    expect(serialized).not.toContain('DSD-A-001');
    expect(serialized).not.toContain('DSD-R-001');
    expect(serialized).not.toContain('B-001');
    expect(serialized).not.toContain('dsd-english-original');
  });

  it('emits an ISO timestamp rather than a Date', () => {
    expect(presentEntry(aggregate(), OPTIONS).updated_at).toBe('2026-08-03T09:00:00.000Z');
  });
});

describe('audio', () => {
  it('prefers mp3, which is the serving format', () => {
    const presented = presentEntry(aggregate(), OPTIONS);
    expect(presented.pronunciations[0].audio_url).toBe(
      `https://cdn.dsdtech.site/audio/dsd/audio/en-aria/${'b'.repeat(64)}.mp3`,
    );
  });

  it('falls back to the only format available', () => {
    expect(
      audioUrl('https://cdn/audio', [{ storageKey: 'dsd/audio/en-aria/x.wav', format: 'wav' }]),
    ).toBe('https://cdn/audio/dsd/audio/en-aria/x.wav');
  });

  it('is null when no audio is servable', () => {
    // dsd_servable_audio already excludes unreviewed and quarantined assets, so
    // an empty list means there is nothing approved to play.
    expect(audioUrl('https://cdn/audio', [])).toBeNull();
  });

  it('is null when no public base url is configured', () => {
    expect(audioUrl('', [{ storageKey: 'k', format: 'mp3' }])).toBeNull();
  });

  it('does not double a trailing slash', () => {
    expect(audioUrl('https://cdn/audio/', [{ storageKey: 'k', format: 'mp3' }])).toBe(
      'https://cdn/audio/k',
    );
  });
});

describe('presentSearchHits', () => {
  const hits = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      headword: 'rehearse',
      partOfSpeech: 'verb',
      definitionEn: 'To practise beforehand.',
      translationVi: 'diễn tập',
    },
  ];

  it('shapes a hit with DSD identity', () => {
    expect(presentSearchHits(hits)).toEqual([
      {
        id: '11111111-1111-1111-1111-111111111111',
        word: 'rehearse',
        part_of_speech: 'verb',
        definition_en: 'To practise beforehand.',
        definition_vi: 'diễn tập',
      },
    ]);
  });

  it('carries a null translation through rather than inventing one', () => {
    expect(presentSearchHits([{ ...hits[0], translationVi: null }])[0].definition_vi).toBeNull();
  });

  it('emits nothing for no hits', () => {
    expect(presentSearchHits([])).toEqual([]);
  });
});

describe('relations', () => {
  it('presents an approved DSD relation with its headword', () => {
    const relations = presentEntry(aggregate(), OPTIONS).definitions[0].relations;
    expect(relations).toEqual([
      {
        type: 'synonym',
        word: 'practise',
        sense_id: '66666666-6666-6666-6666-666666666666',
      },
    ]);
  });

  it('presents an empty list when a sense has none', () => {
    // Most senses have no relations, which is normal and not incompleteness.
    const bare = aggregate();
    (bare.senses[0] as any).relations = [];
    expect(presentEntry(bare, OPTIONS).definitions[0].relations).toEqual([]);
  });

  it('tolerates the field being absent altogether', () => {
    const bare = aggregate();
    delete (bare.senses[0] as any).relations;
    expect(presentEntry(bare, OPTIONS).definitions[0].relations).toEqual([]);
  });
});
