import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { DictionaryService } from './dictionary.service';
import { LlmService } from '../llm/llm.service';
import { Word } from './entities/word.entity';
import { Pronunciation } from './entities/pronunciation.entity';
import { Definition } from './entities/definition.entity';
import { Example } from './entities/example.entity';
import { WordForm } from './entities/word-form.entity';
import { Synonym } from './entities/synonym.entity';
import { AudioService } from './audio.service';
import { SearchIndexService } from '../common/search/search-index.service';
import { RedisCacheService } from '../common/cache/redis-cache.service';
import { LearnerEntry } from './entities/learner-entry.entity';
import { LearnerSenseTranslation } from './entities/learner-sense-translation.entity';
import { DSD_CORPUS_CONFIG } from '../dsd-corpus/dsd-corpus.module';
import { DsdCorpusConfig } from '../dsd-corpus/dsd-corpus.config';
import { DsdQueryService } from '../dsd-corpus/dsd-query.service';

function emptyRepo() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
  };
}

async function buildModule(overrides: {
  llmService?: Partial<LlmService>;
  config?: Record<string, unknown>;
  httpService?: Partial<HttpService>;
  wordRepository?: ReturnType<typeof emptyRepo>;
  learnerEntryRepository?: ReturnType<typeof emptyRepo>;
  learnerTranslationRepository?: ReturnType<typeof emptyRepo>;
  dsdQueryService?: Partial<DsdQueryService>;
  dsdConfig?: Partial<DsdCorpusConfig>;
} = {}) {
  const module = await Test.createTestingModule({
    providers: [
      DictionaryService,
      { provide: getRepositoryToken(Word), useValue: overrides.wordRepository || emptyRepo() },
      { provide: getRepositoryToken(Pronunciation), useValue: emptyRepo() },
      { provide: getRepositoryToken(Definition), useValue: emptyRepo() },
      { provide: getRepositoryToken(Example), useValue: emptyRepo() },
      { provide: getRepositoryToken(WordForm), useValue: emptyRepo() },
      { provide: getRepositoryToken(Synonym), useValue: emptyRepo() },
      { provide: getRepositoryToken(LearnerEntry), useValue: overrides.learnerEntryRepository || emptyRepo() },
      { provide: getRepositoryToken(LearnerSenseTranslation), useValue: overrides.learnerTranslationRepository || emptyRepo() },
      {
        provide: DsdQueryService,
        useValue: overrides.dsdQueryService ?? {
          available: false,
          findCompleteEntry: jest.fn().mockResolvedValue(null),
          search: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: DSD_CORPUS_CONFIG,
        useValue: {
          database: 'dsd_corpus_db',
          releaseChannel: 'off',
          activeReleaseId: '',
          connections: {},
          errors: [],
          ...overrides.dsdConfig,
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({
              'llm.enableFallback': true,
              'content.commercialSafeMode': false,
              'content.allowGeneratedContent': false,
              ...overrides.config,
            } as Record<string, unknown>)[key],
        },
      },
      {
        provide: HttpService,
        useValue: { get: jest.fn(), post: jest.fn(), ...overrides.httpService },
      },
      {
        provide: LlmService,
        useValue: {
          lookupDictionaryWord: jest.fn(),
          translate: jest.fn(),
          ...overrides.llmService,
        },
      },
      { provide: AudioService, useValue: { getAudioUrl: jest.fn().mockResolvedValue(null) } },
      { provide: SearchIndexService, useValue: { searchWords: jest.fn().mockResolvedValue([]) } },
      {
        provide: RedisCacheService,
        useValue: {
          // Pass-through cache: just execute the factory each time
          getOrSet: jest.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
          getWordDetailTTL: jest.fn().mockReturnValue(60),
          getSearchTTL: jest.fn().mockReturnValue(60),
        },
      },
    ],
  }).compile();
  return module.get(DictionaryService);
}

describe('DictionaryService.lookupWord — LLM path', () => {
  it('delegates to LlmService.lookupDictionaryWord and returns its result', async () => {
    const fakeEntry = {
      word: 'serendipity',
      pronunciations: [],
      definitions: [{
        pos: 'noun',
        definition_en: 'The chance discovery of something valuable.',
        definition_vi: 'sự tình cờ may mắn',
        level: 'advanced',
        examples: [],
      }],
      word_forms: {},
      synonyms: [],
    };
    const llmService = { lookupDictionaryWord: jest.fn().mockResolvedValue(fakeEntry) };
    const svc = await buildModule({ llmService });
    const result = await svc.lookupWord('serendipity');
    expect(llmService.lookupDictionaryWord).toHaveBeenCalledWith('serendipity');
    expect(result).toMatchObject({
      word: 'serendipity',
      data_source: 'generated_fallback',
      definitions: [{
        definition_vi: 'sự tình cờ may mắn',
        data_status: 'generated',
        quality_flags: ['generated_fallback'],
        is_learner_visible: false,
        source: 'LLM fallback',
      }],
    });
  });
});

describe('DictionaryService.lookupWord — curated learner path', () => {
  it('prefers published learner senses and does not expose raw senses', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValue({
      id: 7,
      word: 'study',
      frequencyRank: null,
      pronunciations: [],
      definitions: [{ definitionEn: 'raw definition', definitionVi: 'raw meaning', definitionOrder: 1, examples: [] }],
      wordForms: [],
    });
    const learnerEntryRepository = emptyRepo();
    learnerEntryRepository.findOne.mockResolvedValue({
      wordId: 7,
      learnerRank: 100,
      learnerBand: 'NGSL 1',
      rankSource: 'NGSL',
      rankSourceVersion: '1.2',
      rankSourceLicense: 'CC BY-SA 4.0',
      status: 'published',
      pronunciations: [{
        accent: 'US',
        ipa: '/ˈstʌdi/',
        priority: 1,
        reviewStatus: 'approved',
      }],
      senses: [{
        id: 'sense-1',
        senseOrder: 1,
        partOfSpeech: 'verb',
        definitionEn: 'To spend time learning about a subject.',
        cefrLevel: 'A1',
        cefrSource: 'human_review',
        cefrBasis: 'independent_human_review',
        cefrSourceVersion: '2026-07',
        cefrSourceLicense: 'project-owned',
        status: 'published',
        definitionSource: 'reviewed project data',
        definitionSourceLicense: 'project-owned',
        senseKey: 'study-v-1',
        translations: [{
          locale: 'vi',
          text: 'học; nghiên cứu một môn học',
          method: 'independent_human_review',
          source: 'DuskStillDev bilingual review',
          sourceLicense: 'project-owned',
          reviewStatus: 'approved',
        }],
        examples: [{
          exampleOrder: 1,
          exampleEn: 'I study English every day.',
          exampleVi: 'Tôi học tiếng Anh mỗi ngày.',
          reviewStatus: 'approved',
        }],
      }],
    });

    const svc = await buildModule({ wordRepository, learnerEntryRepository });
    const result = await svc.lookupWord('study');

    expect(result.data_source).toBe('curated');
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({
      definition_vi: 'học; nghiên cứu một môn học',
      level: 'beginner',
      cefr_level: 'A1',
      cefr_source: 'human_review',
      cefr_basis: 'independent_human_review',
      sense_id: 'sense-1',
      data_status: 'reviewed',
      translation_source: 'DuskStillDev bilingual review',
      translation_method: 'independent_human_review',
    });
    expect(result.definitions[0].definition_en).not.toContain('raw');
    expect(result.definitions[0].examples).toEqual([
      { en: 'I study English every day.', vi: 'Tôi học tiếng Anh mỗi ngày.' },
    ]);
    expect(result.frequency_rank).toBe(100);
    expect(result).toMatchObject({
      learner_band: 'NGSL 1',
      rank_source: 'NGSL',
      rank_source_version: '1.2',
    });
  });

  it('falls back to sanitized raw data when Vietnamese is not approved', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValue({
      id: 7,
      word: 'study',
      frequencyRank: 200,
      pronunciations: [],
      definitions: [{
        definitionEn: 'To learn about a subject.',
        definitionVi: 'học về một môn học',
        definitionOrder: 1,
        partOfSpeech: 'verb',
        level: 'beginner',
        examples: [],
        qualityFlags: [],
        isLearnerVisible: true,
        reviewStatus: 'raw',
      }],
      wordForms: [],
    });
    const learnerEntryRepository = emptyRepo();
    learnerEntryRepository.findOne.mockResolvedValue({
      wordId: 7,
      status: 'published',
      pronunciations: [],
      senses: [{
        status: 'published',
        senseOrder: 1,
        translations: [{ locale: 'vi', text: 'chưa duyệt', reviewStatus: 'draft' }],
        examples: [],
      }],
    });

    const svc = await buildModule({ wordRepository, learnerEntryRepository });
    const result = await svc.lookupWord('study');

    expect(result.data_source).toBe('raw_fallback');
    expect(result.definitions[0].definition_vi).toBe('học về một môn học');
    expect(result.definitions[0].definition_vi).not.toBe('chưa duyệt');
    expect(result.definitions[0]).toMatchObject({
      data_status: 'raw',
      is_learner_visible: false,
    });
  });
});

describe('DictionaryService — commercial-safe boundary', () => {
  it('publishes durable attribution for every approved upstream data source', async () => {
    const svc = await buildModule({
      config: { 'content.commercialSafeMode': true },
    });

    expect(svc.getAttribution()).toMatchObject({
      commercial_safe_mode: true,
      software_license: 'MIT',
      sources: [
        { name: 'Open English WordNet', license: 'CC BY 4.0' },
        { name: 'New General Service List', license: 'CC BY-SA 4.0' },
      ],
    });
  });

  it('does not expose a legacy word or generate replacement content', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValue({
      id: 7,
      word: 'study',
      definitions: [{ definitionEn: 'legacy text', definitionVi: 'dữ liệu cũ' }],
    });
    const llmService = { lookupDictionaryWord: jest.fn() };
    const svc = await buildModule({
      wordRepository,
      llmService,
      config: {
        'content.commercialSafeMode': true,
        'content.allowGeneratedContent': false,
      },
    });

    await expect(svc.lookupWord('study')).rejects.toMatchObject({ status: 404 });
    expect(llmService.lookupDictionaryWord).not.toHaveBeenCalled();
  });

  it('does not inherit an unapproved legacy frequency rank', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValue({
      id: 7,
      word: 'study',
      frequencyRank: 42,
    });
    const learnerEntryRepository = emptyRepo();
    learnerEntryRepository.findOne.mockResolvedValue({
      wordId: 7,
      learnerRank: null,
      status: 'published',
      pronunciations: [],
      senses: [{
        id: 'sense-1',
        senseOrder: 1,
        partOfSpeech: 'verb',
        definitionEn: 'To spend time learning about a subject.',
        status: 'published',
        translations: [{
          locale: 'vi',
          text: 'học',
          reviewStatus: 'approved',
        }],
        examples: [],
      }],
    });
    const svc = await buildModule({
      wordRepository,
      learnerEntryRepository,
      config: { 'content.commercialSafeMode': true },
    });

    const result = await svc.lookupWord('study');

    expect(result.data_source).toBe('curated');
    expect(result.frequency_rank).toBeUndefined();
  });

  it('blocks unapproved generated translation endpoints', async () => {
    const llmService = { translate: jest.fn() };
    const svc = await buildModule({
      llmService,
      config: {
        'content.commercialSafeMode': true,
        'content.allowGeneratedContent': false,
      },
    });

    await expect(svc.translate({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'vi',
    })).rejects.toMatchObject({ status: 403 });
    expect(llmService.translate).not.toHaveBeenCalled();
  });
});

describe('DictionaryService.translate', () => {
  it('returns LlmService.translate result on success', async () => {
    const llmService = {
      translate: jest.fn().mockResolvedValue({
        original_text: 'Hello',
        translated_text: 'Xin chào',
        source_lang: 'en',
        target_lang: 'vi',
      }),
    };
    const svc = await buildModule({ llmService });
    const result = await svc.translate({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'vi',
    });
    expect(result.translated_text).toBe('Xin chào');
    expect(llmService.translate).toHaveBeenCalled();
  });

  it('falls back to MyMemory when LlmService.translate throws', async () => {
    const llmService = {
      translate: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const httpService = {
      get: jest.fn().mockReturnValue(
        of({
          data: { responseData: { translatedText: 'Xin chào (mm)' } },
        }),
      ),
    };
    const svc = await buildModule({ llmService, httpService });
    const result = await svc.translate({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'vi',
    });
    expect(result.translated_text).toBe('Xin chào (mm)');
    expect(httpService.get).toHaveBeenCalledWith(
      expect.stringContaining('api.mymemory.translated.net'),
      expect.any(Object),
    );
  });
});

describe('DictionaryService.resolve — bilingual direction', () => {
  it('uses approved published Vietnamese glosses for a diacritic-free query', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValue(null);
    const learnerTranslationRepository = emptyRepo();
    learnerTranslationRepository.find.mockResolvedValue([{
      text: 'học; nghiên cứu một môn học',
      sense: {
        id: 'sense-study',
        definitionEn: 'To spend time learning about a subject.',
        partOfSpeech: 'verb',
        senseOrder: 1,
        entry: {
          learnerRank: 100,
          word: { word: 'study' },
        },
        examples: [{
          reviewStatus: 'approved',
          exampleOrder: 1,
          exampleEn: 'I study English.',
          exampleVi: 'Tôi học tiếng Anh.',
        }],
      },
    }]);
    const llmService = { translate: jest.fn() };
    const svc = await buildModule({
      wordRepository,
      learnerTranslationRepository,
      llmService,
    });

    const result = await svc.resolve('hoc', 'auto');

    expect(result).toMatchObject({
      kind: 'translation',
      direction: 'vi-en',
      translation: { translated_text: 'study' },
      matches: [{
        word: 'study',
        definition_vi: 'học; nghiên cứu một môn học',
        definition_en: 'To spend time learning about a subject.',
        examples: [{ en: 'I study English.', vi: 'Tôi học tiếng Anh.' }],
      }],
    });
    expect(llmService.translate).not.toHaveBeenCalled();
  });

  it('keeps an exact English headword in the English-to-Vietnamese direction', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValueOnce({ id: 7, word: 'study' });
    const svc = await buildModule({ wordRepository });
    const lookup = jest.spyOn(svc, 'lookupWord').mockResolvedValue({
      word: 'study',
      pronunciations: [],
      definitions: [],
    });

    const result = await svc.resolve('study', 'auto');

    expect(result).toMatchObject({ kind: 'dictionary', direction: 'en-vi' });
    expect(lookup).toHaveBeenCalledWith('study');
  });

  it('falls back to sentence translation when no reviewed gloss matches', async () => {
    const learnerTranslationRepository = emptyRepo();
    const llmService = {
      translate: jest.fn().mockResolvedValue({
        original_text: 'bầu trời xanh',
        translated_text: 'blue sky',
        source_lang: 'vi',
        target_lang: 'en',
      }),
    };
    const svc = await buildModule({ learnerTranslationRepository, llmService });

    const result = await svc.resolve('bầu trời xanh', 'vi-en');

    expect(result).toMatchObject({
      kind: 'translation',
      direction: 'vi-en',
      matches: [],
      translation: { translated_text: 'blue sky' },
    });
  });
});

// ─── Task 15: commercial traffic goes to DSD, or nowhere ─────────────────────

const DSD_ENTRY = {
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
      definitionEn: 'To practise beforehand.',
      usageLabels: [],
      translations: [{ id: 't1', locale: 'vi', text: 'diễn tập' }],
      examples: [{ id: 'x1', exampleOrder: 1, exampleEn: 'They rehearse.', exampleVi: 'Họ diễn tập.' }],
    },
  ],
  pronunciations: [{ id: 'p1', accent: 'en-US', ipa: 'rɪˈhɜːrs', priority: 1, audio: [] }],
};

/** A legacy word repository that would happily answer if it were asked. */
function legacyRepoWithWord() {
  const repo = emptyRepo();
  repo.findOne = jest.fn().mockResolvedValue({
    id: 42,
    word: 'rehearse',
    wordNormalized: 'rehearse',
    definitions: [],
    pronunciations: [],
    wordForms: [],
  });
  repo.find = jest.fn().mockResolvedValue([{ id: 42, word: 'rehearse' }]);
  return repo;
}

function dsdPublic(found: unknown = DSD_ENTRY) {
  return {
    dsdQueryService: {
      available: true,
      findCompleteEntry: jest.fn().mockResolvedValue(found),
      search: jest.fn().mockResolvedValue(
        found
          ? [
              {
                id: DSD_ENTRY.entry.id,
                headword: 'rehearse',
                partOfSpeech: 'verb',
                definitionEn: 'To practise beforehand.',
                translationVi: 'diễn tập',
              },
            ]
          : [],
      ),
    } as unknown as Partial<DsdQueryService>,
    dsdConfig: {
      releaseChannel: 'public' as const,
      activeReleaseId: 'DSD-REL-V1-5000-a1b2c3d4',
    },
    config: { 'content.commercialSafeMode': true, 'llm.enableFallback': false },
  };
}

describe('commercial mode routes to DSD only', () => {
  it('serves a lookup from DSD', async () => {
    const svc = await buildModule(dsdPublic());
    const result: any = await svc.lookupWord('rehearse');
    expect(result.word).toBe('rehearse');
    expect(result.data_source).toBe('dsd');
    expect(result.definitions[0].meaning_vi).toBe('diễn tập');
  });

  it('makes zero legacy repository calls', async () => {
    // The assertion that matters: legacy holds the word and is never asked.
    const wordRepository = legacyRepoWithWord();
    const learnerEntryRepository = legacyRepoWithWord();
    const svc = await buildModule({ ...dsdPublic(), wordRepository, learnerEntryRepository });

    await svc.lookupWord('rehearse');

    expect(wordRepository.findOne).not.toHaveBeenCalled();
    expect(wordRepository.find).not.toHaveBeenCalled();
    expect(learnerEntryRepository.findOne).not.toHaveBeenCalled();
    expect(learnerEntryRepository.find).not.toHaveBeenCalled();
  });

  it('returns 404 on a DSD miss even though legacy has the word', async () => {
    const wordRepository = legacyRepoWithWord();
    const svc = await buildModule({ ...dsdPublic(null), wordRepository });

    await expect(svc.lookupWord('rehearse')).rejects.toThrow(/not found in dictionary/);
    expect(wordRepository.findOne).not.toHaveBeenCalled();
  });

  it('keeps generated fallback disabled on a miss', async () => {
    const lookupDictionaryWord = jest.fn();
    const svc = await buildModule({
      ...dsdPublic(null),
      llmService: { lookupDictionaryWord } as unknown as Partial<LlmService>,
    });

    await expect(svc.lookupWord('rehearse')).rejects.toThrow(/not found/);
    expect(lookupDictionaryWord).not.toHaveBeenCalled();
  });

  it('serves search from DSD and asks no legacy repository', async () => {
    const learnerEntryRepository = legacyRepoWithWord();
    const svc = await buildModule({ ...dsdPublic(), learnerEntryRepository });

    const result = await svc.searchWords({ q: 'reh', limit: 5 } as any);
    expect(result.suggestions[0].word).toBe('rehearse');
    expect(learnerEntryRepository.find).not.toHaveBeenCalled();
  });
});

describe('the off channel serves nothing from DSD, and never falls back', () => {
  it('does not consult DSD when the channel is off', async () => {
    const dsd = {
      available: false,
      findCompleteEntry: jest.fn().mockResolvedValue(DSD_ENTRY),
      search: jest.fn().mockResolvedValue([]),
    } as unknown as Partial<DsdQueryService>;
    const svc = await buildModule({
      dsdQueryService: dsd,
      dsdConfig: { releaseChannel: 'off', activeReleaseId: '' },
      config: { 'content.commercialSafeMode': true, 'llm.enableFallback': false },
    });

    await expect(svc.lookupWord('rehearse')).rejects.toThrow();
    expect(dsd.findCompleteEntry).not.toHaveBeenCalled();
  });

  it('does not serve DSD content on the internal channel to a public request', async () => {
    const routed = dsdPublic();
    const svc = await buildModule({
      ...routed,
      dsdConfig: { releaseChannel: 'internal', activeReleaseId: 'DSD-REL-PILOT-20260803-a1b2c3d4' },
    });

    await expect(svc.lookupWord('rehearse')).rejects.toThrow();
    expect(routed.dsdQueryService.findCompleteEntry).not.toHaveBeenCalled();
  });
});

describe('cache keys cannot mix corpora', () => {
  async function keyFor(overrides: Parameters<typeof buildModule>[0]) {
    const keys: string[] = [];
    const svc = await buildModule(overrides);
    // Keep the TTL helpers the service asks for; only getOrSet is observed.
    const real = (svc as any).cacheService;
    (svc as any).cacheService = {
      ...real,
      getOrSet: jest.fn(async (key: string, factory: () => Promise<unknown>) => {
        keys.push(key);
        return factory();
      }),
      getWordDetailTTL: () => 3600,
      getSearchTTL: () => 300,
    };
    await svc.lookupWord('rehearse').catch(() => undefined);
    return keys[0];
  }

  it('names the release, so a body cached under another release is not reused', async () => {
    const key = await keyFor(dsdPublic());
    expect(key).toContain('DSD-REL-V1-5000-a1b2c3d4');
  });

  it('differs between two DSD releases', async () => {
    const first = await keyFor(dsdPublic());
    const second = await keyFor({
      ...dsdPublic(),
      dsdConfig: { releaseChannel: 'public', activeReleaseId: 'DSD-REL-V1-20000-99887766' },
    });
    expect(first).not.toBe(second);
  });

  it('differs between reference and commercial mode', async () => {
    const reference = await keyFor({ config: { 'content.commercialSafeMode': false } });
    const commercial = await keyFor(dsdPublic());
    expect(reference).not.toBe(commercial);
    expect(reference).toContain('reference');
  });
});
