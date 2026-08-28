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

function emptyRepo() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
  };
}

async function buildModule(overrides: {
  llmService?: Partial<LlmService>;
  config?: Record<string, unknown>;
  httpService?: Partial<HttpService>;
  wordRepository?: ReturnType<typeof emptyRepo>;
  definitionRepository?: ReturnType<typeof emptyRepo>;
  learnerEntryRepository?: ReturnType<typeof emptyRepo>;
  learnerTranslationRepository?: ReturnType<typeof emptyRepo>;
  searchIndexService?: { searchWords: jest.Mock };
} = {}) {
  const module = await Test.createTestingModule({
    providers: [
      DictionaryService,
      { provide: getRepositoryToken(Word), useValue: overrides.wordRepository || emptyRepo() },
      { provide: getRepositoryToken(Pronunciation), useValue: emptyRepo() },
      { provide: getRepositoryToken(Definition), useValue: overrides.definitionRepository || emptyRepo() },
      { provide: getRepositoryToken(Example), useValue: emptyRepo() },
      { provide: getRepositoryToken(WordForm), useValue: emptyRepo() },
      { provide: getRepositoryToken(Synonym), useValue: emptyRepo() },
      { provide: getRepositoryToken(LearnerEntry), useValue: overrides.learnerEntryRepository || emptyRepo() },
      { provide: getRepositoryToken(LearnerSenseTranslation), useValue: overrides.learnerTranslationRepository || emptyRepo() },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({
              'llm.enableFallback': true,
              'dictionary.dataSource': 'primary',
              'dictionary.allowGeneratedFallback': true,
              'dictionary.allowExternalFallback': true,
              'dictionary.vietnameseSearchEnabled': true,
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
      {
        provide: SearchIndexService,
        useValue: overrides.searchIndexService
          || { searchWords: jest.fn().mockResolvedValue([]) },
      },
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

describe('DictionaryService — primary production data boundary', () => {
  it('reports the primary database and disabled fallbacks', async () => {
    const svc = await buildModule({
      config: {
        'dictionary.allowGeneratedFallback': false,
        'dictionary.allowExternalFallback': false,
      },
    });

    expect(svc.getAttribution()).toMatchObject({
      software_license: 'MIT',
      dictionary_data_source: 'primary',
      generated_fallback_enabled: false,
      external_fallback_enabled: false,
    });
  });

  it('serves an existing primary-database word', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockResolvedValue({
      id: 7,
      word: 'study',
      frequencyRank: 42,
      pronunciations: [],
      definitions: [{
        definitionOrder: 1,
        partOfSpeech: 'verb',
        definitionEn: 'To learn about a subject.',
        definitionVi: 'học về một môn học',
        qualityFlags: [],
        examples: [],
      }],
      wordForms: [],
    });
    const svc = await buildModule({
      wordRepository,
      config: {
        'dictionary.allowGeneratedFallback': false,
      },
    });

    const result = await svc.lookupWord('study');
    expect(result).toMatchObject({
      word: 'study',
      data_source: 'raw_fallback',
      frequency_rank: 42,
    });
  });

  it('does not generate a replacement when the primary database misses', async () => {
    const llmService = { lookupDictionaryWord: jest.fn() };
    const svc = await buildModule({
      llmService,
      config: {
        'dictionary.allowGeneratedFallback': false,
      },
    });

    await expect(svc.lookupWord('study')).rejects.toMatchObject({ status: 404 });
    expect(llmService.lookupDictionaryWord).not.toHaveBeenCalled();
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

  it('searches Vietnamese meanings in the existing production definitions', async () => {
    const definitionRepository = emptyRepo();
    definitionRepository.query.mockResolvedValueOnce([{
      id: '77',
      definition_vi: 'học về một môn học',
      definition_en: 'To spend time learning about a subject.',
      part_of_speech: 'verb',
      definition_order: 1,
      word: 'study',
      frequency_rank: 100,
    }]).mockResolvedValueOnce([]);
    const svc = await buildModule({ definitionRepository });

    const result = await svc.resolve('học', 'vi-en');

    expect(result).toMatchObject({
      kind: 'translation',
      direction: 'vi-en',
      translation: { translated_text: 'study' },
      matches: [{
        word: 'study',
        definition_vi: 'học về một môn học',
        data_source: 'raw_fallback',
      }],
    });
    expect(definitionRepository.query).toHaveBeenCalledWith(
      expect.stringContaining('definition_vi_normalized'),
      ['hoc', 'hoc!', 240],
    );
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

describe('primary dictionary cache keys', () => {
  it('reserves auto-search space for accent-free Vietnamese matches', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockImplementation(async ({ where }: any) => ({
      word: where.word,
      pronunciations: [],
      definitions: [],
    }));
    const definitionRepository = emptyRepo();
    definitionRepository.query
      .mockResolvedValueOnce([{
        id: '77',
        definition_vi: 'học về một môn học',
        definition_en: 'To spend time learning about a subject.',
        part_of_speech: 'verb',
        definition_order: 1,
        word: 'study',
        frequency_rank: 100,
      }])
      .mockResolvedValueOnce([]);
    const searchIndexService = {
      searchWords: jest.fn().mockResolvedValue([
        { word: 'hoc' },
        { word: 'hockey' },
      ]),
    };
    const svc = await buildModule({
      wordRepository,
      definitionRepository,
      searchIndexService,
    });

    const result = await svc.searchWords({ q: 'hoc', limit: 2, direction: 'auto' });

    expect(result.suggestions).toEqual([
      expect.objectContaining({ word: 'hoc', direction: 'en-vi' }),
      expect.objectContaining({
        word: 'study',
        direction: 'vi-en',
        matched_text: 'học về một môn học',
      }),
    ]);
  });

  it('resolves marked Vietnamese before an exact multilingual headword', async () => {
    const wordRepository = emptyRepo();
    wordRepository.findOne.mockImplementation(async ({ where }: any) => {
      const clauses = Array.isArray(where) ? where : [where];
      const requested = clauses[0]?.word;
      if (requested !== 'study') return null;
      return {
        id: 7,
        word: 'study',
        frequencyRank: 100,
        pronunciations: [],
        definitions: [{
          definitionEn: 'To learn about a subject.',
          definitionVi: 'học về một môn học',
          definitionOrder: 1,
          partOfSpeech: 'verb',
          qualityFlags: [],
          examples: [],
        }],
        wordForms: [],
      };
    });
    const definitionRepository = emptyRepo();
    definitionRepository.query.mockResolvedValueOnce([{
      id: '77',
      definition_vi: 'học về một môn học',
      definition_en: 'To spend time learning about a subject.',
      part_of_speech: 'verb',
      definition_order: 1,
      word: 'study',
      frequency_rank: 100,
    }]);
    const svc = await buildModule({ wordRepository, definitionRepository });

    const result = await svc.lookupWord('học');

    expect(result).toMatchObject({ word: 'study', data_source: 'raw_fallback' });
    expect(wordRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('names the primary search schema and includes direction', async () => {
    const keys: string[] = [];
    const svc = await buildModule();
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

    await svc.searchWords({ q: 'hoc', limit: 5, direction: 'vi-en' });

    expect(keys[0]).toContain('primary:v1');
    expect(keys[0]).toContain('vi-en');
    expect(keys[0]).not.toContain('dsd');
  });
});
