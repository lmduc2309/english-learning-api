import { SearchIndexService } from './search-index.service';

function wordQueryBuilder(words: unknown[]) {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    select: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(words),
  };

  for (const method of ['leftJoinAndSelect', 'select', 'orderBy', 'addOrderBy'] as const) {
    queryBuilder[method].mockReturnValue(queryBuilder);
  }
  return queryBuilder;
}

describe('SearchIndexService learner priority', () => {
  it('returns published learner entries before raw prefix matches', async () => {
    const rawWords = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1,
      word: `a${String(index).padStart(3, '0')}`,
      frequencyRank: null,
      learnerEntry: null,
    }));
    const reviewedWord = {
      id: 1000,
      word: 'azure',
      frequencyRank: null,
      learnerEntry: { id: 'entry-1', learnerRank: 12 },
    };
    const queryBuilder = wordQueryBuilder([...rawWords, reviewedWord]);
    const service = new SearchIndexService(
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as any,
      {} as any,
    );

    await (service as any).rebuildWordIndex();
    (service as any).indexInitialized = true;

    const results = await service.searchWords('a', 3);

    expect(results[0]).toMatchObject({
      word: 'azure',
      learnerRank: 12,
      isLearnerEntry: true,
    });
  });

  it('keeps an exact raw headword ahead of longer reviewed matches', async () => {
    const queryBuilder = wordQueryBuilder([
      { id: 1, word: 'app', frequencyRank: null, learnerEntry: null },
      {
        id: 2,
        word: 'application',
        frequencyRank: null,
        learnerEntry: { id: 'entry-2', learnerRank: 2 },
      },
      {
        id: 3,
        word: 'apply',
        frequencyRank: null,
        learnerEntry: { id: 'entry-3', learnerRank: 1 },
      },
    ]);
    const service = new SearchIndexService(
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as any,
      {} as any,
    );

    await (service as any).rebuildWordIndex();
    (service as any).indexInitialized = true;

    const results = await service.searchWords('app', 3);

    expect(results.map((result) => result.word)).toEqual([
      'app',
      'apply',
      'application',
    ]);
  });
});
