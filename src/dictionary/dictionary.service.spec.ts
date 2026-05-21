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
} = {}) {
  const module = await Test.createTestingModule({
    providers: [
      DictionaryService,
      { provide: getRepositoryToken(Word), useValue: emptyRepo() },
      { provide: getRepositoryToken(Pronunciation), useValue: emptyRepo() },
      { provide: getRepositoryToken(Definition), useValue: emptyRepo() },
      { provide: getRepositoryToken(Example), useValue: emptyRepo() },
      { provide: getRepositoryToken(WordForm), useValue: emptyRepo() },
      { provide: getRepositoryToken(Synonym), useValue: emptyRepo() },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({ 'llm.enableFallback': true, ...overrides.config } as Record<string, unknown>)[key],
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
      definitions: [],
      word_forms: {},
      synonyms: [],
    };
    const llmService = { lookupDictionaryWord: jest.fn().mockResolvedValue(fakeEntry) };
    const svc = await buildModule({ llmService });
    const result = await svc.lookupWord('serendipity');
    expect(llmService.lookupDictionaryWord).toHaveBeenCalledWith('serendipity');
    expect(result).toEqual(fakeEntry);
  });
});
