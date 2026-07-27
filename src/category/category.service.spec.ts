import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { CategoryWord } from './entities/category-word.entity';
import { Word } from '../dictionary/entities/word.entity';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import { RedisCacheService } from '../common/cache/redis-cache.service';
import { SearchIndexService } from '../common/search/search-index.service';

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

async function buildService() {
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
});
