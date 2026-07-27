import { BadRequestException } from '@nestjs/common';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import { WordList } from '../word-list/entities/word-list.entity';
import { LookupHistory } from './entities/lookup-history.entity';
import { WordFolder } from './entities/word-folder.entity';
import { LearningService } from './learning.service';
import { ReviewRating } from './leitner';

function repository(overrides: Record<string, unknown> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async value => value),
    create: jest.fn(value => value),
    delete: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
}

function learnerRepository(entries: Partial<LearnerEntry>[] = []) {
  const queryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(entries),
  };

  return {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    queryBuilder,
  };
}

function serviceWith(
  wordRepo = repository(),
  learnerRepo = learnerRepository(),
) {
  return new LearningService(
    repository() as never,
    repository() as never,
    wordRepo as never,
    learnerRepo as never,
  );
}

describe('LearningService review eligibility', () => {
  it('returns only due words backed by approved learner content', async () => {
    const candidates = [
      { id: 'raw-id', word: 'raw-word', nextReviewAt: new Date('2026-07-19T00:00:00Z') },
      { id: 'study-id', word: 'study', nextReviewAt: new Date('2026-07-20T00:00:00Z') },
    ] as WordList[];
    const wordRepo = repository({ find: jest.fn().mockResolvedValue(candidates) });
    const learnerRepo = learnerRepository([
      {
        word: { word: 'Study', wordNormalized: 'study' },
      } as LearnerEntry,
    ]);
    const service = serviceWith(wordRepo, learnerRepo);

    await expect(service.due('user-id')).resolves.toEqual([candidates[1]]);
    expect(learnerRepo.queryBuilder.innerJoin).toHaveBeenCalledWith(
      'entry.senses',
      'sense',
      'sense.status = :senseStatus',
      { senseStatus: 'published' },
    );
    expect(learnerRepo.queryBuilder.innerJoin).toHaveBeenCalledWith(
      'sense.translations',
      'translation',
      expect.stringContaining('translation.reviewStatus = :translationStatus'),
      expect.objectContaining({ translationStatus: 'approved', translationLocale: 'vi' }),
    );
  });

  it('rejects rating a raw reference-only saved word', async () => {
    const savedWord = {
      id: 'raw-id',
      userId: 'user-id',
      word: 'raw-word',
      reviewStage: 0,
      reviewSuccesses: 0,
      reviewFailures: 0,
    } as WordList;
    const wordRepo = repository({ findOne: jest.fn().mockResolvedValue(savedWord) });
    const service = serviceWith(wordRepo, learnerRepository());

    await expect(service.rate('user-id', 'raw-id', 'easy')).rejects.toThrow(
      new BadRequestException(
        'Saved word is reference-only and cannot be reviewed until its learner content is approved',
      ),
    );
    expect(wordRepo.save).not.toHaveBeenCalled();
  });

  it('rates an eligible learner word and persists its new schedule', async () => {
    const savedWord = {
      id: 'study-id',
      userId: 'user-id',
      word: 'study',
      reviewStage: 0,
      reviewSuccesses: 0,
      reviewFailures: 0,
    } as WordList;
    const wordRepo = repository({ findOne: jest.fn().mockResolvedValue(savedWord) });
    const learnerRepo = learnerRepository([
      { word: { word: 'study', wordNormalized: 'study' } } as LearnerEntry,
    ]);
    const service = serviceWith(wordRepo, learnerRepo);

    const result = await service.rate('user-id', 'study-id', 'easy');

    expect(result).toMatchObject({ reviewStage: 1, reviewSuccesses: 1, reviewFailures: 0 });
    expect(result.nextReviewAt).toBeInstanceOf(Date);
    expect(result.lastReviewedAt).toBeInstanceOf(Date);
    expect(wordRepo.save).toHaveBeenCalledWith(savedWord);
  });

  it('rejects an unknown rating before reading or mutating saved words', async () => {
    const wordRepo = repository();
    const service = serviceWith(wordRepo, learnerRepository());

    await expect(
      service.rate('user-id', 'study-id', 'skip' as ReviewRating),
    ).rejects.toThrow(new BadRequestException('Rating must be again, hard, or easy'));
    expect(wordRepo.findOne).not.toHaveBeenCalled();
    expect(wordRepo.save).not.toHaveBeenCalled();
  });
});
