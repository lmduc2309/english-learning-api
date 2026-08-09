import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { CategoryWord } from './entities/category-word.entity';
import { Word } from '../dictionary/entities/word.entity';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import { RedisCacheService } from '../common/cache/redis-cache.service';
import { SearchIndexService } from '../common/search/search-index.service';
import { ConfigService } from '@nestjs/config';
import { DSD_CORPUS_CONFIG } from '../dsd-corpus/dsd-corpus.module';

function queryBuilder() {
  const builder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    leftJoin: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
  };
  for (const method of [
    'select',
    'addSelect',
    'leftJoin',
    'leftJoinAndSelect',
    'innerJoin',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ] as const) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

function repository() {
  return {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: unknown) => value),
    save: jest.fn(async (value: unknown) => value),
    delete: jest.fn(),
  };
}

async function buildService(commercialSafeMode = false,
  dsdChannel: 'off' | 'internal' | 'public' = 'off',
) {
  const categoryRepository = repository();
  const categoryWordRepository = repository();
  const wordRepository = repository();
  const learnerEntryRepository = repository();
  const cache = {
    getOrSet: jest.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
    getTopicTTL: jest.fn().mockReturnValue(60),
    getCategoryTTL: jest.fn().mockReturnValue(60),
    getSearchTTL: jest.fn().mockReturnValue(60),
    invalidateCategoryCaches: jest.fn().mockResolvedValue(undefined),
    invalidateTopicCaches: jest.fn().mockResolvedValue(undefined),
  };

  const module = await Test.createTestingModule({
    providers: [
      CategoryService,
      { provide: getRepositoryToken(Category), useValue: categoryRepository },
      { provide: getRepositoryToken(CategoryWord), useValue: categoryWordRepository },
      { provide: getRepositoryToken(Word), useValue: wordRepository },
      { provide: getRepositoryToken(LearnerEntry), useValue: learnerEntryRepository },
      { provide: RedisCacheService, useValue: cache },
      {
        provide: SearchIndexService,
        useValue: {
          searchCategories: jest.fn().mockResolvedValue([]),
          searchTopics: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: ConfigService,
        useValue: { get: jest.fn().mockReturnValue(commercialSafeMode) },
      },
      {
        provide: DSD_CORPUS_CONFIG,
        useValue: {
          database: 'dsd_corpus_db',
          releaseChannel: dsdChannel,
          activeReleaseId: dsdChannel === 'off' ? '' : 'DSD-REL-V1-5000-a1b2c3d4',
          connections: {},
          errors: [],
        },
      },
    ],
  }).compile();

  return {
    service: module.get(CategoryService),
    categoryRepository,
    categoryWordRepository,
    wordRepository,
    learnerEntryRepository,
    cache,
  };
}

describe('CategoryService learner-only catalog', () => {
  it('serves no legacy or learner categories when commercial-safe mode is enabled', async () => {
    const { service, categoryRepository, cache } = await buildService(true);
    const qb = queryBuilder();
    categoryRepository.createQueryBuilder.mockReturnValue(qb);

    await service.getTopics(false);

    expect(cache.getOrSet).not.toHaveBeenCalled();
    expect(categoryRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('partitions topic caches and applies the published learner predicate only when requested', async () => {
    const { service, categoryRepository, cache } = await buildService();
    const referenceQb = queryBuilder();
    const learnerQb = queryBuilder();
    categoryRepository.createQueryBuilder
      .mockReturnValueOnce(referenceQb)
      .mockReturnValueOnce(learnerQb);

    await service.getTopics();
    await service.getTopics(true);

    expect(cache.getOrSet.mock.calls[0][0]).toBe('all:reference');
    expect(cache.getOrSet.mock.calls[1][0]).toBe('all:learner');
    expect(referenceQb.innerJoin).not.toHaveBeenCalled();
    expect(learnerQb.innerJoin).toHaveBeenCalledWith('c.categoryWords', 'cw');
    expect(learnerQb.where).toHaveBeenCalledWith(
      expect.stringContaining('learner_translation.review_status = \'approved\''),
    );
  });

  it('filters both the total and page query and emits only the curated presenter for an eligible word', async () => {
    const {
      service,
      categoryRepository,
      categoryWordRepository,
      learnerEntryRepository,
      cache,
    } = await buildService();
    const category = {
      id: 5,
      name: 'animals',
      displayName: 'Animals',
      description: null,
      icon: null,
      topic: 'Nature',
      parentId: null,
    };
    categoryRepository.findOne.mockResolvedValue(category);

    const countQb = queryBuilder();
    countQb.getCount.mockResolvedValue(1);
    const wordsQb = queryBuilder();
    wordsQb.getMany.mockResolvedValue([{
      word: {
        id: 7,
        word: 'cat',
        frequencyRank: null,
        pronunciations: [],
        definitions: [{
          partOfSpeech: 'noun',
          definitionEn: 'raw definition',
          definitionVi: 'raw translation',
          definitionOrder: 1,
          qualityFlags: [],
          examples: [],
        }],
        wordForms: [],
      },
    }]);
    categoryWordRepository.createQueryBuilder
      .mockReturnValueOnce(countQb)
      .mockReturnValueOnce(wordsQb);

    const subcategoryQb = queryBuilder();
    categoryRepository.createQueryBuilder.mockReturnValue(subcategoryQb);
    learnerEntryRepository.find.mockResolvedValue([{
      wordId: 7,
      status: 'published',
      learnerRank: 500,
      learnerBand: 'NGSL',
      rankSource: 'NGSL',
      rankSourceVersion: '1.2',
      rankSourceLicense: 'CC BY-SA 4.0',
      pronunciations: [],
      senses: [{
        id: 'sense-1',
        senseOrder: 1,
        partOfSpeech: 'noun',
        definitionEn: 'A small domesticated feline animal.',
        status: 'published',
        senseKey: 'cat-n-1',
        definitionSource: 'reviewed source',
        definitionSourceLicense: 'project-owned',
        translations: [{
          locale: 'vi',
          text: 'con mèo',
          method: 'human_review',
          source: 'project review',
          sourceLicense: 'project-owned',
          reviewStatus: 'approved',
        }],
        examples: [],
      }],
    }]);

    const result = await service.getCategoryWords('animals', 1, 20, undefined, true);

    const learnerPredicate = expect.stringContaining('FROM learner_entries learner_entry');
    expect(countQb.andWhere).toHaveBeenCalledWith(learnerPredicate);
    expect(wordsQb.andWhere).toHaveBeenCalledWith(learnerPredicate);
    expect(cache.getOrSet.mock.calls[0][0]).toBe('5:p1:l20:learner');
    expect(result).toMatchObject({
      totalWords: 1,
      totalPages: 1,
      hasMore: false,
      words: [{
        word: 'cat',
        data_source: 'curated',
        frequency_rank: 500,
        definitions: [{
          definition_vi: 'con mèo',
          data_status: 'reviewed',
          is_learner_visible: true,
        }],
      }],
    });
  });

  it('invalidates list and topic caches when category membership changes', async () => {
    const {
      service,
      categoryRepository,
      categoryWordRepository,
      wordRepository,
      cache,
    } = await buildService();
    categoryRepository.findOne.mockResolvedValue({ id: 5, name: 'animals' });
    wordRepository.findOne.mockResolvedValue({ id: 7, word: 'cat' });
    categoryWordRepository.findOne.mockResolvedValue(null);

    await service.addWordsToCategory('animals', ['cat']);

    expect(cache.invalidateCategoryCaches).toHaveBeenCalledWith();
    expect(cache.invalidateTopicCaches).toHaveBeenCalledWith();
  });

  it('fails closed instead of formatting raw category data in commercial mode', async () => {
    const {
      service,
      categoryRepository,
      categoryWordRepository,
    } = await buildService(true);
    categoryRepository.findOne.mockResolvedValue({
      id: 5,
      name: 'animals',
      displayName: 'Animals',
      topic: 'Nature',
    });

    const countQb = queryBuilder();
    countQb.getCount.mockResolvedValue(1);
    const wordsQb = queryBuilder();
    wordsQb.getMany.mockResolvedValue([{
      word: {
        id: 7,
        word: 'cat',
        frequencyRank: 42,
        pronunciations: [],
        definitions: [{ definitionEn: 'legacy definition' }],
        wordForms: [],
      },
    }]);
    categoryWordRepository.createQueryBuilder
      .mockReturnValueOnce(countQb)
      .mockReturnValueOnce(wordsQb);
    categoryRepository.createQueryBuilder.mockReturnValue(queryBuilder());

    const result = await service.getCategoryWords('animals');

    expect(result.words).toEqual([]);
  });
});

// ─── Task 15: commercial category endpoints never serve legacy data ──────────

describe('categories on the public DSD channel', () => {
  it('returns no topics rather than legacy or learner packs', async () => {
    // DSD has no native categories yet. An empty list is a visibly missing
    // feature; serving reference packs as lesson content is a licensing problem
    // nobody notices.
    const { service, categoryRepository } = await buildService(true, 'public');
    expect(await service.getTopics()).toEqual([]);
    expect(categoryRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns no categories and runs no query', async () => {
    const { service, categoryRepository } = await buildService(true, 'public');
    expect(await service.getCategories('travel')).toEqual([]);
    expect(categoryRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns no subcategories and runs no query', async () => {
    const { service, categoryRepository } = await buildService(true, 'public');
    expect(await service.getSubCategories('travel')).toEqual([]);
    expect(categoryRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns an empty page of words without touching a repository', async () => {
    const { service, categoryRepository, wordRepository } = await buildService(true, 'public');
    const result = await service.getCategoryWords('travel', 1, 20);
    expect(result).toMatchObject({ words: [], total: 0, page: 1, limit: 20 });
    expect(categoryRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(wordRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('writes nothing to the cache, so nothing survives a mode switch', async () => {
    const { service, cache } = await buildService(true, 'public');
    await service.getTopics();
    expect(cache.getOrSet).not.toHaveBeenCalled();
  });
});

describe('categories on the off channel fail closed', () => {
  it('does not consult legacy categories in commercial mode', async () => {
    const { service, categoryRepository } = await buildService(true, 'off');
    expect(await service.getTopics()).toEqual([]);
    expect(categoryRepository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
